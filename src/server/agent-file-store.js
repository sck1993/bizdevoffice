const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
// data/uploads — 이미 마운트된 clawoffice_device 볼륨 내에 저장해 컨테이너 재시작 후에도 유지
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DESK_SLOT_COUNT = 4; // Must match desk prop count in data/office.json (see office-file-store.js getDeskCount)

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
    .replace(/^-|-$/g, "");

  // 한국어 등 비ASCII 이름은 slug가 비어 있으므로 타임스탬프 기반 ID 사용
  const base = slug || `agent-${Date.now()}`;

  let candidate = base;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter++}`;
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
