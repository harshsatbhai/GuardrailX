import { useState, useRef, useEffect } from "react";
import { Copy, Check, ShieldAlert, Image, Music, Video, FileText, TrendingUp, Sparkles, Pencil, Share2, RotateCcw, Upload } from "lucide-react";
import RiskBadge from "./RiskBadge";

const MODALITY_ICON = { image: Image, audio: Music, video: Video, document: FileText };

function cleanFormattedText(rawText) {
  if (!rawText) return "";
  let text = rawText;

  // 1. Remove markdown headings like "### Title" or "# Header" -> "Title"
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");

  // 2. Remove bold/italic asterisks: ***text*** -> text, **text** -> text, *text* -> text
  text = text.replace(/\*{1,3}(.*?)\*{1,3}/g, "$1");

  // 3. Remove markdown table divider lines like |---|---| or |:---:|:---|
  text = text.replace(/^[ \t]*\|?[ \t]*(:?-{2,}:?[ \t]*\|)+(:?-{2,}:?[ \t]*)?\|?[ \t]*$/gm, "");

  // 4. Remove standalone horizontal rules: ---, ----, ___, etc.
  text = text.replace(/^[ \t]*[-_]{3,}[ \t]*$/gm, "");

  // 5. Replace pipe characters '|' used in tables or formatting with clean spaces/separators
  text = text.replace(/[ \t]*\|[ \t]*/g, "   ");

  // 6. Remove any remaining stray asterisks or hashes
  text = text.replace(/[*#]/g, "");

  // 7. Strip number prefix ONLY if it's a major section heading (e.g. "1. How it works", "2. A simple everyday analogy")
  // Keep numbered points (1. Creating a pair, 2. Separate them) or ensure points are properly numbered.
  text = text.replace(/^([ \t]*)[0-9]+[.)][ \t]+([A-Z][^\n:]{2,80}\([^\n]+\))$/gm, "$1$2");
  text = text.replace(/^([ \t]*)[0-9]+[.)][ \t]+(How it works|A simple everyday analogy|Why it's .*|Real-world uses|Real‑world uses|Bottom line|Overview|Summary|Conclusion|Key takeaways)/gim, "$1$2");

  // 8. Collapse 3+ consecutive line breaks into 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

function FormattedResponse({ text }) {
  if (!text) return null;

  // Split into paragraphs / sections
  const paragraphs = text.split(/\n\n+/);

  // If it's a short, single-paragraph response (e.g., greetings like "Hi! How can I help you today?"),
  // render directly as normal text without turning it into a giant title.
  if (paragraphs.length <= 1) {
    const trimmed = text.trim();
    // Only treat as title if it's very short AND has explicit section following it
    return (
      <div className="text-[15px] leading-relaxed text-ink/90 whitespace-pre-wrap">
        {trimmed}
      </div>
    );
  }

  // Check if this response actually has structured sections
  const hasMultipleSections = paragraphs.length >= 2;

  // Helper to test if a line is a major section title / subheading (no bullets)
  const isSubheading = (str) => {
    const s = str.trim();
    if (!s || s.length > 80 || s.endsWith(".") || s.endsWith(",") || s.includes("  ")) return false;
    const lower = s.toLowerCase();
    if (
      lower.startsWith("how it works") ||
      lower.startsWith("a simple everyday") ||
      lower.startsWith("why it's") ||
      lower.startsWith("real-world") ||
      lower.startsWith("real‑world") ||
      lower.startsWith("bottom line") ||
      lower.startsWith("overview") ||
      lower.startsWith("summary") ||
      lower.startsWith("conclusion") ||
      lower.startsWith("key takeaways")
    ) {
      return true;
    }
    return !/^[0-9]+[.)]/.test(s) && s.length < 50 && !s.includes(":") && !s.includes("?");
  };

  return (
    <div className="space-y-4 text-[15px] leading-relaxed">
      {paragraphs.map((para, idx) => {
        const trimmed = para.trim();
        if (!trimmed) return null;

        const lines = trimmed.split("\n");
        const firstLine = lines[0].trim();

        // 1. Main Title: only if multi-paragraph document AND first paragraph is a short standalone title without punctuation
        if (
          idx === 0 &&
          hasMultipleSections &&
          lines.length === 1 &&
          firstLine.length <= 80 &&
          !firstLine.endsWith(".") &&
          !firstLine.endsWith("?") &&
          !firstLine.endsWith("!") &&
          !firstLine.endsWith(",")
        ) {
          return (
            <h1 key={idx} className="text-xl sm:text-2xl font-bold tracking-tight text-ink pt-1 pb-1">
              {firstLine.replace(/^[0-9]+[.)]\s*/, "")}
            </h1>
          );
        }

        // 2. Standalone Subheading line (no bullets)
        if (lines.length === 1 && isSubheading(firstLine)) {
          return (
            <h2 key={idx} className="text-base sm:text-lg font-semibold text-ink pt-2 pb-0.5">
              {firstLine.replace(/^[0-9]+[.)]\s*/, "")}
            </h2>
          );
        }

        // 3. Subheading followed by body text / points in the same block
        if (lines.length > 1 && isSubheading(firstLine)) {
          const restLines = lines.slice(1);
          return (
            <div key={idx} className="space-y-2">
              <h2 className="text-base sm:text-lg font-semibold text-ink pt-2 pb-0.5">
                {firstLine.replace(/^[0-9]+[.)]\s*/, "")}
              </h2>
              <div className="space-y-2 text-ink/90 font-normal">
                {renderContentLines(restLines)}
              </div>
            </div>
          );
        }

        // 4. Regular block or list of points
        return (
          <div key={idx} className="space-y-2 text-ink/90 font-normal">
            {renderContentLines(lines)}
          </div>
        );
      })}
    </div>
  );
}

// Helper to render lines with proper numbering for points
function renderContentLines(lines) {
  // Check if lines are points that should be numbered (e.g., "Creating a pair", "Separate them" or already numbered)
  let currentNum = 1;
  const rendered = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if line is already numbered: e.g. "1. Creating a pair" or "1. ..."
    const numMatch = trimmed.match(/^([0-9]+)[.)]\s*(.*)$/);
    if (numMatch) {
      const pointTitle = numMatch[2];
      rendered.push(
        <div key={i} className="text-ink/90 font-normal leading-relaxed">
          <span className="font-medium text-ink mr-1.5">{numMatch[1]}.</span>
          {pointTitle}
        </div>
      );
      currentNum = parseInt(numMatch[1], 10) + 1;
      continue;
    }

    // Check if line is a short point title without numbers (e.g. "Creating a pair", "Separate them")
    // followed by indentation or descriptive sentences
    const isShortPointHeader = trimmed.length < 60 && !trimmed.endsWith(".") && !trimmed.endsWith(",") && !trimmed.includes("  ");
    const nextLineIsIndented = i + 1 < lines.length && (lines[i + 1].startsWith(" ") || lines[i + 1].startsWith("\t") || lines[i + 1].trim().length > 0);

    if (isShortPointHeader && nextLineIsIndented) {
      rendered.push(
        <div key={i} className="text-ink/90 font-normal leading-relaxed pt-1">
          <span className="font-medium text-ink mr-1.5">{currentNum}.</span>
          <span className="font-medium text-ink">{trimmed}</span>
        </div>
      );
      currentNum++;
      continue;
    }

    // Normal body line
    rendered.push(
      <div key={i} className="text-ink/90 font-normal leading-relaxed whitespace-pre-wrap">
        {trimmed}
      </div>
    );
  }

  return rendered;
}

export function TypingIndicator({ label }) {
  return (
    <div className="flex items-start msg-animate">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-border bg-panel px-4 py-3 h-11">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
        </div>
        {label && <p className="text-xs text-muted/70 ml-1">{label}</p>}
      </div>
    </div>
  );
}

export default function ChatMessage({ message: m, onEditMessage, onRegenerate }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [sharedResponse, setSharedResponse] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(m.text || "");
  const editInputRef = useRef(null);

  useEffect(() => {
    setEditText(m.text || "");
  }, [m.text]);

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.style.height = "auto";
      editInputRef.current.style.height = editInputRef.current.scrollHeight + "px";
    }
  }, [isEditing]);

  const FileIcon = m.fileModality ? MODALITY_ICON[m.fileModality] : null;

  function copyText() {
    const textToCopy = m.role === "assistant" ? cleanFormattedText(m.text) : m.text;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function sharePrompt() {
    if (navigator.share) {
      navigator.share({
        title: "Shared Prompt",
        text: m.text,
      }).catch(() => {
        copyText();
      });
    } else {
      navigator.clipboard.writeText(m.text).then(() => {
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      });
    }
  }

  function shareResponse() {
    const textToShare = cleanFormattedText(m.text);
    if (navigator.share) {
      navigator.share({
        title: "Shared Response",
        text: textToShare,
      }).catch(() => {
        copyText();
      });
    } else {
      navigator.clipboard.writeText(textToShare).then(() => {
        setSharedResponse(true);
        setTimeout(() => setSharedResponse(false), 2000);
      });
    }
  }

  function handleSaveEdit() {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setIsEditing(false);
    if (onEditMessage) {
      onEditMessage(trimmed);
    }
  }

  function handleCancelEdit() {
    setEditText(m.text || "");
    setIsEditing(false);
  }

  /* System / info message */
  if (m.role === "system") {
    return (
      <div className="flex justify-center msg-animate">
        <div className="max-w-lg text-center rounded-xl border border-border/60 bg-panel2/40 px-5 py-3 text-sm text-muted/80 italic leading-relaxed">
          {m.text}
        </div>
      </div>
    );
  }

  /* User message */
  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end group msg-animate">
        {isEditing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-border bg-panel p-3 shadow-md">
            <textarea
              ref={editInputRef}
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveEdit();
                } else if (e.key === "Escape") {
                  handleCancelEdit();
                }
              }}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none"
              rows={2}
            />
            <div className="mt-2.5 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-panel2 hover:text-ink transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors shadow-sm"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-accent px-5 py-3 text-[15px] leading-relaxed text-white shadow-sm">
              {FileIcon && (
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-white/85 border-b border-white/15 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <FileIcon size={13} />
                    <span className="capitalize">{m.fileModality}</span> file
                  </div>
                  {m.fileSize && (
                    <span className="text-[11px] opacity-75 font-mono">
                      {m.fileSize / 1024 < 1024
                        ? `${Math.round(m.fileSize / 1024)} KB`
                        : `${(m.fileSize / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                  )}
                </div>
              )}
              <div className="whitespace-pre-wrap font-medium break-all">{m.text}</div>

              {/* Audio player preview */}
              {m.fileModality === "audio" && m.fileUrl && (
                <div className="mt-2.5 pt-2 border-t border-white/20">
                  <audio
                    controls
                    className="w-full max-w-sm h-8 rounded-lg outline-none brightness-95"
                    src={m.fileUrl}
                    preload="metadata"
                  >
                    Your browser does not support audio playback.
                  </audio>
                </div>
              )}

              {/* Video player preview */}
              {m.fileModality === "video" && m.fileUrl && (
                <div className="mt-2.5 pt-2 border-t border-white/20">
                  <video
                    controls
                    className="w-full max-w-md max-h-56 rounded-lg bg-black/40 shadow outline-none"
                    src={m.fileUrl}
                    preload="metadata"
                  >
                    Your browser does not support video playback.
                  </video>
                </div>
              )}

              {/* Image preview */}
              {m.fileModality === "image" && m.fileUrl && (
                <div className="mt-2.5 pt-2 border-t border-white/20">
                  <img
                    src={m.fileUrl}
                    alt={m.text}
                    className="max-w-xs max-h-52 rounded-lg object-contain bg-black/20 shadow"
                  />
                </div>
              )}
            </div>

            {/* ChatGPT-style hover action bar */}
            <div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-muted">
              {/* Copy */}
              <button
                type="button"
                onClick={copyText}
                title={copied ? "Copied!" : "Copy message"}
                className="rounded-md p-1.5 hover:bg-panel2 hover:text-ink transition-colors"
              >
                {copied ? <Check size={14} className="text-safe" /> : <Copy size={14} />}
              </button>

              {/* Edit */}
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                title="Edit message"
                className="rounded-md p-1.5 hover:bg-panel2 hover:text-ink transition-colors"
              >
                <Pencil size={14} />
              </button>

              {/* Share */}
              <button
                type="button"
                onClick={sharePrompt}
                title={shared ? "Copied share link!" : "Share prompt"}
                className="rounded-md p-1.5 hover:bg-panel2 hover:text-ink transition-colors"
              >
                {shared ? <Check size={14} className="text-safe" /> : <Share2 size={14} />}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  /* Assistant message */
  const isError = m.meta?.isSystemError;
  const displayText = cleanFormattedText(m.text);

  return (
    <div className="flex items-start group msg-animate w-full">
      <div className="flex-1 min-w-0">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-white"><Sparkles size={11} strokeWidth={2.4} /></span>
          GuardrailX
        </div>
        <div className={`relative rounded-2xl rounded-tl-sm px-5 py-3.5 text-[15px] leading-relaxed ${
          isError
            ? "border border-danger/30 bg-danger/5 text-ink"
            : "border border-border bg-panel text-ink shadow-sm"
        }`}>
          {/* Top-right action icons: Try again -> Share -> Copy */}
          {!isError && (
            <div className="absolute right-3 top-3 flex items-center gap-1.5 z-10 text-muted">
              {/* 1. Try Again button */}
              {onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  title="Try again"
                  className="rounded-md p-1.5 hover:bg-panel2 hover:text-ink transition-colors group/btn"
                >
                  <RotateCcw size={14} className="group-hover/btn:-rotate-90 transition-transform duration-200" />
                </button>
              )}

              {/* 2. Share button (up arrow like ChatGPT) */}
              <button
                type="button"
                onClick={shareResponse}
                title={sharedResponse ? "Copied share link!" : "Share"}
                className="rounded-md p-1.5 hover:bg-panel2 hover:text-ink transition-colors"
              >
                {sharedResponse ? <Check size={14} className="text-safe" /> : <Upload size={14} />}
              </button>

              {/* 3. Copy button */}
              <button
                type="button"
                onClick={copyText}
                title={copied ? "Copied!" : "Copy"}
                className="rounded-md p-1.5 hover:bg-panel2 hover:text-ink transition-colors"
              >
                {copied ? <Check size={14} className="text-safe" /> : <Copy size={14} />}
              </button>
            </div>
          )}

          {/* Error label */}
          {isError && (
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-danger">
              <ShieldAlert size={13} /> Service Error
            </div>
          )}

          {/* Security metadata */}
          {m.meta && !isError && (
            <div className="mb-3 flex flex-wrap items-center gap-2 pr-28">
              <RiskBadge action={m.meta.action} riskScore={m.meta.risk_score} />
              {m.meta.input_modality && m.meta.input_modality !== "text" && (
                <span className="rounded-full border border-border bg-panel2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                  {m.meta.input_modality}
                </span>
              )}
            </div>
          )}

          {/* Message text */}
          <FormattedResponse text={displayText} />

          {/* Extracted text */}
          {m.meta?.extracted_text && (
            <div className="mt-3 rounded-lg border border-border/60 bg-panel2 px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                  Extracted text
                </span>
                {m.meta.input_modality && (
                  <span className="text-[10px] text-muted/60 uppercase font-mono">
                    via {m.meta.input_modality} scanner
                  </span>
                )}
              </div>
              <div className="font-mono text-xs text-muted leading-relaxed">
                "{m.meta.extracted_text}"
              </div>

              {/* Video breakdown if both visual OCR and audio track are present */}
              {m.meta.input_modality === "video" && (m.meta.ocr_text || m.meta.audio_text) && (
                <div className="mt-2 pt-2 border-t border-border/40 text-[11px] text-muted space-y-1">
                  {m.meta.ocr_text && (
                    <div><span className="font-semibold text-ink/75">Frame OCR:</span> {m.meta.ocr_text}</div>
                  )}
                  {m.meta.audio_text && (
                    <div><span className="font-semibold text-ink/75">Audio track:</span> {m.meta.audio_text}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Redactions */}
          {m.meta?.redactions?.length > 0 && (
            <div className="mt-2 text-xs text-muted font-mono">
              Redacted: {m.meta.redactions.map((r) => r.type).join(", ")}
            </div>
          )}

          {/* Domain signals */}
          {m.meta?.domain_features?.fired_signals?.length > 0 && (
            <div className="mt-3 rounded-lg border border-border/60 bg-panel2 px-3 py-2.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                Domain signals detected
              </div>
              <div className="flex flex-wrap gap-1.5">
                {m.meta.domain_features.fired_signals.map((sig) => (
                  <span
                    key={sig}
                    className="rounded-full border border-danger/25 bg-danger/8 px-2 py-0.5 text-[10px] font-mono text-danger"
                  >
                    {sig}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Finance signals */}
          {m.meta?.finance_signals?.fired_finance_signals?.length > 0 && (
            <div className="mt-3 rounded-lg border border-border/60 bg-panel2 px-3 py-2.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70 flex items-center gap-1.5">
                <TrendingUp size={11} className="text-accent" />
                Finance Threat Signals
              </div>
              <div className="flex flex-wrap gap-1.5">
                {m.meta.finance_signals.fired_finance_signals.map((sig) => (
                  <span
                    key={sig}
                    className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] font-mono text-accent"
                  >
                    {sig}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
