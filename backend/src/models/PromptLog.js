const mongoose = require("mongoose");

const PromptLogSchema = new mongoose.Schema({
  user_id: { type: String, default: "anonymous" },
  ip_address: { type: String, required: true },
  prompt_text: { type: String, required: true },
  label: { type: String, enum: ["safe", "malicious"], required: true },
  attack_type: { type: String, default: "None" },
  attack_type_source: { type: String, enum: ["ml_model", "keyword_fallback", "llm_guard", "n/a"], default: "n/a" },
  risk_score: { type: Number, required: true },
  action_taken: { type: String, enum: ["ALLOW", "WARN", "BLOCK"], required: true },
  response_time_ms: { type: Number, default: 0 },
  llm_response_redacted: { type: Boolean, default: false },
  input_modality: { type: String, enum: ["text", "image", "audio", "video", "document"], default: "text" },
  domain: { type: String, enum: ["general", "finance"], default: "general" },
  blocked_by: { type: [String], default: [] },
  guard_layers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  llm_model: { type: String, default: null },
  output_blocked: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

PromptLogSchema.index({ created_at: -1 });
PromptLogSchema.index({ ip_address: 1 });
PromptLogSchema.index({ label: 1 });

module.exports = mongoose.model("PromptLog", PromptLogSchema);
