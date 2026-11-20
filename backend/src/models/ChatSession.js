const mongoose = require("mongoose");

const ChatSessionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  client_id: { type: String, required: true },
  title: { type: String, default: "New Chat", maxlength: 100 },
  messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

ChatSessionSchema.index({ user_id: 1, client_id: 1 }, { unique: true });
ChatSessionSchema.index({ user_id: 1, updated_at: -1 });

module.exports = mongoose.model("ChatSession", ChatSessionSchema);
