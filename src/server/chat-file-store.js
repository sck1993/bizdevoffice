const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const CHATS_DIR = path.join(DATA_DIR, "chats");
const MAX_MESSAGES = 500;

fs.mkdirSync(CHATS_DIR, { recursive: true });

const _locks = new Map();

function withLock(agentId, fn) {
  const prev = _locks.get(agentId) ?? Promise.resolve();
  const next = prev.then(() => fn());
  _locks.set(agentId, next.catch(() => {}));
  return next;
}

function chatFilePath(agentId) {
  return path.join(CHATS_DIR, `${agentId}.json`);
}

function loadMessages(agentId) {
  const file = chatFilePath(agentId);
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("chat file must contain an array");
    return parsed;
  } catch {
    try { fs.renameSync(file, file + ".bak"); } catch {}
    console.error(`[chat-file-store] ${agentId}.json corrupted - reset to empty`);
    return [];
  }
}

function saveMessages(agentId, messages) {
  const file = chatFilePath(agentId);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(messages, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

async function appendMessages(agentId, newMessages) {
  return withLock(agentId, () => {
    const existing = loadMessages(agentId);
    const combined = [...existing, ...newMessages].slice(-MAX_MESSAGES);
    saveMessages(agentId, combined);
  });
}

async function removeChat(agentId) {
  return withLock(agentId, () => {
    const file = chatFilePath(agentId);
    for (const f of [file, file + ".bak"]) {
      try { fs.unlinkSync(f); } catch (e) {
        if (e.code !== "ENOENT") console.error(`[chat-file-store] failed to remove ${f}:`, e);
      }
    }
  });
}

module.exports = { loadMessages, appendMessages, removeChat };
