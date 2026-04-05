const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
const DESK_SLOT_COUNT = 4;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let _writeLock = Promise.resolve();

function withLock(fn) {
  const next = _writeLock.then(() => fn());
  _writeLock = next.catch(() => {});
  return next;
}

function loadAll() {
  try {
    if (!fs.existsSync(AGENTS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(AGENTS_FILE, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("agents.json must contain an array");
    return parsed;
  } catch {
    try {
      fs.renameSync(AGENTS_FILE, AGENTS_FILE + ".bak");
    } catch {}
    console.error("[agent-file-store] agents.json corrupted - reset to empty");
    return [];
  }
}

function saveAll(agents) {
  const tmp = AGENTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(agents, null, 2), "utf8");
  fs.renameSync(tmp, AGENTS_FILE);
}

function toAgentId(name, existingIds) {
  const slug = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "agent";

  let candidate = slug;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${slug}-${counter++}`;
  }
  return candidate;
}

function getNextDeskIndex(agents) {
  const used = new Set(
    agents
      .map((agent) => agent?.deskIndex)
      .filter((deskIndex) => Number.isInteger(deskIndex) && deskIndex >= 0),
  );

  for (let index = 0; index < DESK_SLOT_COUNT; index += 1) {
    if (!used.has(index)) return index;
  }

  return -1;
}

module.exports = {
  AGENTS_FILE,
  UPLOADS_DIR,
  withLock,
  loadAll,
  saveAll,
  toAgentId,
  getNextDeskIndex,
};
