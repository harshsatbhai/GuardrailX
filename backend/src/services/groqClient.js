/**
 * groqClient.js
 * -------------
 * One shared axios client for every Groq call in the backend: the main
 * chat model (llmService.js) and the LLM guard layers (guardService.js).
 */

const axios = require("axios");
const https = require("https");

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();
const INSECURE_TLS = process.env.GROQ_TLS_INSECURE === "true";

if (INSECURE_TLS) {
  console.warn(
    "[groq] ⚠️  GROQ_TLS_INSECURE=true — TLS certificate verification is DISABLED " +
    "for Groq API calls. Local dev only, never production."
  );
}

const groqClient = axios.create({
  baseURL: GROQ_BASE_URL,
  timeout: Number(process.env.GROQ_TIMEOUT_MS || 60000),
  httpsAgent: INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined,
  headers: {
    Authorization: `Bearer ${GROQ_API_KEY}`,
    "Content-Type": "application/json",
  },
});

function hasGroqKey() {
  return GROQ_API_KEY.length > 0;
}

module.exports = { groqClient, hasGroqKey, GROQ_BASE_URL };
