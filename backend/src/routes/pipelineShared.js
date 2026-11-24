const { filterLlmResponse } = require("../services/mlService");
const { generateResponse } = require("../services/llmService");
const { checkInput, combineDecision, checkOutput } = require("../services/guardService");
const { recordViolation } = require("../middleware/rateLimiter");
const PromptLog = require("../models/PromptLog");

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 8000;

/**
 * Validates the optional chat history sent by the frontend so the LLM can
 * answer follow-up questions in context. Only user/assistant string turns
 * are accepted, capped by count and total size (newest turns kept).
 */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const clean = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    .slice(-MAX_HISTORY_MESSAGES);
  let total = 0;
  const kept = [];
  for (let i = clean.length - 1; i >= 0; i--) {
    total += clean[i].content.length;
    if (total > MAX_HISTORY_CHARS) break;
    kept.unshift(clean[i]);
  }
  return kept;
}

/**
 * Runs the LLM guard layers in parallel with an already-started ML
 * classification and merges them (strictest layer wins).
 */
async function classifyWithAllLayers(mlPromise, text, history) {
  const [ml, llmLayers] = await Promise.all([mlPromise, checkInput(text, { history })]);
  return combineDecision(ml, llmLayers);
}

const OUTPUT_BLOCKED_MESSAGE =
  "The model's reply was withheld by the output guard because it may contain unsafe content or internal instructions.";

/**
 * Shared by /api/check-prompt and /api/check-multimodal: given a combined
 * classification and the ORIGINAL text used for it, runs the rest of the
 * pipeline — real LLM call if allowed, output guard, PII filtering,
 * logging, and the response payload.
 */
async function runPostClassificationPipeline({
  classification, promptTextForLLM, req, startTime, extraLogFields = {}, extraResponseFields = {},
  domain, regenerate = false, history = [],
}) {
  const ip = req.ip;
  const userId = req.user?.id || "anonymous";
  const domainValue = domain || "general";

  let llmResponse = null;
  let redactions = [];
  let generation = null;
  let outputGuard = null;
  let action = classification.action;

  if (action === "BLOCK") {
    recordViolation(ip);
  } else {
    const result = await generateResponse(promptTextForLLM, domainValue, {
      regenerate, history, suspicious: action === "WARN",
    });
    generation = {
      provider: result.provider,
      model: result.model,
      id: result.id,
      usage: result.usage,
      finish_reason: result.finish_reason,
      latency_ms: result.latency_ms,
    };

    outputGuard = await checkOutput(promptTextForLLM, result.text, result.system_prompt);
    if (outputGuard.blocked) {
      action = "BLOCK";
      recordViolation(ip);
      llmResponse = null;
    } else {
      const filtered = await filterLlmResponse(result.text, domainValue);
      llmResponse = filtered.filtered_text;
      redactions = filtered.redactions;
    }
  }

  const responseTimeMs = Date.now() - startTime;
  const outputBlocked = Boolean(outputGuard?.blocked);

  await PromptLog.create({
    user_id: userId,
    ip_address: ip,
    prompt_text: promptTextForLLM,
    label: action === "ALLOW" ? "safe" : "malicious",
    attack_type: outputBlocked && classification.attack_type === "None" ? "Unsafe Output" : classification.attack_type,
    attack_type_source: classification.attack_type_source || "n/a",
    risk_score: outputBlocked ? Math.max(classification.risk_score, 0.95) : classification.risk_score,
    action_taken: action,
    response_time_ms: responseTimeMs,
    llm_response_redacted: redactions.length > 0,
    domain: domainValue,
    blocked_by: outputBlocked ? ["output_guard"] : classification.blocked_by || [],
    guard_layers: classification.guard_layers || [],
    llm_model: generation?.model || null,
    output_blocked: outputBlocked,
    ...extraLogFields,
  });

  return {
    action,
    risk_score: outputBlocked ? Math.max(classification.risk_score, 0.95) : classification.risk_score,
    attack_type: classification.attack_type,
    attack_type_source: classification.attack_type_source || "n/a",
    domain_features: classification.domain_features || null,
    finance_signals: classification.finance_signals || null,
    guard_layers: classification.guard_layers || [],
    blocked_by: outputBlocked ? ["output_guard"] : classification.blocked_by || [],
    output_guard: outputGuard ? { blocked: outputGuard.blocked, reasons: outputGuard.reasons } : null,
    generation,
    domain: domainValue,
    llm_response: llmResponse,
    redactions,
    response_time_ms: responseTimeMs,
    message:
      outputBlocked
        ? OUTPUT_BLOCKED_MESSAGE
        : action === "BLOCK"
        ? `This prompt was blocked by the security guardrail (${(classification.blocked_by || []).join(", ") || "policy"}).`
        : action === "WARN"
        ? "This prompt looked suspicious but was allowed under stricter instructions. Response may be filtered."
        : "Prompt allowed.",
    ...extraResponseFields,
  };
}

/**
 * Shared error handler — identical diagnostic logic (ML service vs guard
 * layers vs LLM provider vs database) used by both routes.
 */
function handlePipelineError(err, res) {
  console.error("[pipeline] Error:", err.message);

  if (err.name === "GuardUnavailableError") {
    return res.status(503).json({
      error: "Guard layer unavailable",
      message: `${err.message} Check GROQ_API_KEY and the guard model names in backend/.env, or set GUARD_FAIL_MODE=open.`,
    });
  }
  if (err.name === "EmptyLlmResponseError") {
    return res.status(502).json({ error: "LLM provider error", message: err.message });
  }

  if (err.isAxiosError && err.config?.baseURL?.includes("8000")) {
    const detail = err.response?.data?.detail;
    return res.status(503).json({
      error: "ML service unavailable",
      message: detail
        ? `ML service error: ${detail}`
        : `Could not reach the ML classification service: ${err.message}`,
    });
  }
  if (err.isAxiosError) {
    const providerName = (process.env.LLM_PROVIDER || "groq").toLowerCase() === "ollama" ? "Ollama" : "Groq";
    const upstreamStatus = err.response?.status;
    const upstreamDetail = err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 300)
      : err.message;

    const isCertError = err.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
      /unable to get local issuer certificate/i.test(err.message);
    if (isCertError) {
      return res.status(502).json({
        error: "LLM provider error",
        message:
          `TLS certificate verification failed reaching ${providerName}. This is usually ` +
          "an outdated Node.js install or an incorrect system clock, not an " +
          "API key problem — see the Troubleshooting section in SETUP.md for the fix.",
      });
    }

    const isTimeout = err.code === "ECONNABORTED" || /timeout of \d+ms exceeded/i.test(err.message);
    if (isTimeout && providerName === "Ollama") {
      return res.status(504).json({
        error: "LLM provider error",
        message:
          "Ollama took too long to respond. Try a smaller model (ollama pull llama3.2:1b and set " +
          "OLLAMA_MODEL=llama3.2:1b in backend/.env), or switch to LLM_PROVIDER=groq.",
      });
    }

    return res.status(502).json({
      error: "LLM provider error",
      message: `${providerName} API call failed${upstreamStatus ? ` (status ${upstreamStatus})` : ""}: ${upstreamDetail}`,
    });
  }
  if (err.name === "MongooseError" || err.name === "MongoServerError" || err.name === "ValidationError") {
    return res.status(500).json({
      error: "Database error",
      message: `MongoDB operation failed: ${err.message}. Is MongoDB running and MONGO_URI correct?`,
    });
  }

  return res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
}

module.exports = { runPostClassificationPipeline, handlePipelineError, classifyWithAllLayers, sanitizeHistory };
