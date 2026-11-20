const express = require("express");
const ChatSession = require("../models/ChatSession");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

function serialize(session) {
  return {
    id: session.client_id,
    title: session.title,
    messages: session.messages,
    createdAt: new Date(session.created_at).getTime(),
    updatedAt: new Date(session.updated_at).getTime(),
  };
}

router.get("/", async (req, res, next) => {
  try {
    const sessions = await ChatSession.find({ user_id: req.user.id }).sort({ updated_at: -1 }).lean();
    res.json({ sessions: sessions.map(serialize) });
  } catch (err) { next(err); }
});

// The client sends its complete current list. Replacing only this user's list
// makes deletes and renames sync atomically without exposing another account.
router.put("/", async (req, res, next) => {
  const { sessions } = req.body;
  if (!Array.isArray(sessions) || sessions.length > 100) {
    return res.status(400).json({ error: "sessions must be an array of at most 100 chats" });
  }
  if (sessions.some((session) => !session?.id || typeof session.id !== "string" || !Array.isArray(session.messages))) {
    return res.status(400).json({ error: "Each chat must include an id and messages array" });
  }
  try {
    await ChatSession.deleteMany({ user_id: req.user.id });
    if (sessions.length) {
      await ChatSession.insertMany(sessions.map((session) => ({
        user_id: req.user.id,
        client_id: session.id,
        title: String(session.title || "New Chat").slice(0, 100),
        messages: session.messages,
        created_at: Number.isFinite(session.createdAt) ? new Date(session.createdAt) : new Date(),
        updated_at: Number.isFinite(session.updatedAt) ? new Date(session.updatedAt) : new Date(),
      })));
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
