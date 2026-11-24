const express = require("express");
const multer = require("multer");
const path = require("path");
const { classifyMultimodal } = require("../services/mlService");
const { runPostClassificationPipeline, handlePipelineError, classifyWithAllLayers } = require("./pipelineShared");

const router = express.Router();

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // matches the ML service's own limit
const upload = multer({
  storage: multer.memoryStorage(), // small demo-scale files — no need to touch disk
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const ALLOWED_MODALITIES = new Set(["image", "audio", "video", "document"]);

const MIME_PREFIX_BY_MODALITY = {
  image: "image/",
  audio: "audio/",
  video: "video/",
};

// Browsers may report valid media as application/octet-stream. These
// extensions are accepted by the client picker and can be decoded by the
// scanners, so use the filename as a fallback for image, audio, and video uploads.
const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".ico",
]);

const AUDIO_EXTENSIONS = new Set([
  ".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aac", ".wma",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v",
]);

// POST /api/check-multimodal/:modality   (modality = image | audio | video)
// multipart/form-data, field name "file"
router.post("/:modality", upload.single("file"), async (req, res) => {
  const startTime = Date.now();
  const { modality } = req.params;
  // domain can be sent as a form field alongside the file
  const rawDomain = req.body?.domain;
  const validDomains = ["general", "finance"];
  const resolvedDomain = validDomains.includes(rawDomain) ? rawDomain : "general";

  if (!ALLOWED_MODALITIES.has(modality)) {
    return res.status(400).json({
      error: "Invalid modality",
      message: `Modality must be one of: ${[...ALLOWED_MODALITIES].join(", ")}`,
    });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded (expected multipart field 'file')" });
  }

  const expectedPrefix = MIME_PREFIX_BY_MODALITY[modality];
  const extension = path.extname(req.file.originalname || "").toLowerCase();
  const hasSupportedExtension =
    (modality === "image" && IMAGE_EXTENSIONS.has(extension)) ||
    (modality === "audio" && AUDIO_EXTENSIONS.has(extension)) ||
    (modality === "video" && VIDEO_EXTENSIONS.has(extension));

  if (expectedPrefix && req.file.mimetype && !req.file.mimetype.startsWith(expectedPrefix) && !hasSupportedExtension) {
    return res.status(400).json({
      error: "File type mismatch",
      message: `Expected a ${modality} file (mimetype starting with "${expectedPrefix}"), got "${req.file.mimetype}".`,
    });
  }

  try {
    // Stage 1/2 (ML service): extract text from the file, then classify it
    // exactly like a normal text prompt.
    const mlClassification = await classifyMultimodal(
      req.file.buffer, req.file.originalname, req.file.mimetype, modality, resolvedDomain
    );

    if (!mlClassification.extracted_text) {
      return res.status(422).json({
        error: "No content extracted",
        message: `Could not extract any usable text from the uploaded ${modality} file.`,
      });
    }

    // Text hidden inside images/audio/video/documents goes through the SAME
    // LLM guard layers as typed prompts (indirect prompt injection defence).
    const classification = await classifyWithAllLayers(
      Promise.resolve(mlClassification), mlClassification.extracted_text, []
    );

    const payload = await runPostClassificationPipeline({
      classification,
      promptTextForLLM: classification.extracted_text,
      req,
      startTime,
      domain: resolvedDomain,
      extraLogFields: { input_modality: modality },
      extraResponseFields: {
        input_modality: modality,
        extracted_text: classification.extracted_text,
        ...(modality === "document" && {
          file_name: classification.file_name,
          file_mimetype: classification.file_mimetype,
        }),
        // video responses additionally carry ocr_text / audio_text / frames_sampled
        ...(modality === "video" && {
          ocr_text: classification.ocr_text,
          audio_text: classification.audio_text,
          frames_sampled: classification.frames_sampled,
        }),
      },
    });
    return res.json(payload);
  } catch (err) {
    if (err.isAxiosError && err.response?.status === 422) {
      // ML service's own extraction error (corrupt file, empty OCR, etc.) —
      // surface its message directly rather than the generic 503 branch.
      return res.status(422).json({
        error: "Extraction failed",
        message: err.response.data?.detail || err.message,
      });
    }
    return handlePipelineError(err, res);
  }
});

// Multer-specific error handling (oversized file, etc.) — must be registered
// as error-handling middleware (4 args) directly after the route.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "File too large",
        message: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit.`,
      });
    }
    return res.status(400).json({ error: "Upload error", message: err.message });
  }
  next(err);
});

module.exports = router;
