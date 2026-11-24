const express = require("express");
const { classifyPrompt } = require("../services/mlService");
const {
  runPostClassificationPipeline, handlePipelineError, classifyWithAllLayers, sanitizeHistory,
} = require("./pipelineShared");

const router = express.Router();

// POST /api/check-prompt
// body: { text, domain?, regenerate?, history?: [{ role: "user"|"assistant", content }] }
router.post("/", async (req, res) => {
  const startTime = Date.now();
  const { text, domain, regenerate } = req.body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "`text` field is required" });
  }
  if (text.length > 2000) {
    return res.status(400).json({ error: "Prompt exceeds max length of 2000 characters" });
  }
  const validDomains = ["general", "finance"];
  const resolvedDomain = validDomains.includes(domain) ? domain : "general";
  const history = sanitizeHistory(req.body.history);

  try {
    // ML ensemble + LLM guard layers run in parallel; strictest wins.
    const classification = await classifyWithAllLayers(
      classifyPrompt(text, resolvedDomain), text, history
    );
    const payload = await runPostClassificationPipeline({
      classification,
      promptTextForLLM: text,
      req,
      startTime,
      domain: resolvedDomain,
      regenerate: Boolean(regenerate),
      history,
    });
    return res.json(payload);
  } catch (err) {
    return handlePipelineError(err, res);
  }
});

module.exports = router;
