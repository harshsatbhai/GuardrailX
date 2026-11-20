const express = require("express");
const bcrypt = require("bcryptjs");
const { signToken } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

function publicUser(user) {
  return { id: user._id.toString(), username: user.username, email: user.email };
}

function issueSession(user, res) {
  const userData = publicUser(user);
  res.json({ token: signToken({ id: userData.id, username: userData.username, role: "user" }), user: userData });
}

router.post("/signup", async (req, res, next) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,32}$/.test(username)) return res.status(400).json({ error: "Username must be 3–32 letters, numbers, or underscores." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  try {
    const exists = await User.exists({ $or: [{ username }, { email }] });
    if (exists) return res.status(409).json({ error: "That username or email is already in use." });
    const user = await User.create({ username, email, password_hash: await bcrypt.hash(password, 12) });
    issueSession(user, res);
  } catch (err) { next(err); }
});

router.post("/login", async (req, res, next) => {
  const identity = String(req.body.username || req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  try {
    const user = await User.findOne({ $or: [{ username: identity }, { email: identity }] });
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Incorrect username/email or password." });
    }
    issueSession(user, res);
  } catch (err) { next(err); }
});

module.exports = router;
