const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const OFFICE_FILE = path.join(DATA_DIR, "office.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_CONFIG = {
  props: [
    { id: "desk-0", type: "desk", tileCol: 2, tileRow: 1 },
    { id: "desk-1", type: "desk", tileCol: 4, tileRow: 1 },
    { id: "desk-2", type: "desk", tileCol: 2, tileRow: 2 },
    { id: "desk-3", type: "desk", tileCol: 4, tileRow: 2 },
    { id: "chair-0", type: "meeting_chair", tileCol: 10, tileRow: 2 },
    { id: "chair-1", type: "meeting_chair", tileCol: 12, tileRow: 2 },
    { id: "chair-2", type: "meeting_chair", tileCol: 10, tileRow: 3 },
    { id: "chair-3", type: "meeting_chair", tileCol: 12, tileRow: 3 },
    { id: "chair-4", type: "meeting_chair", tileCol: 11, tileRow: 2 },
    { id: "sofa-0", type: "sofa", tileCol: 1, tileRow: 4 },
    { id: "sofa-1", type: "sofa", tileCol: 2, tileRow: 4 },
    { id: "sofa-2", type: "sofa", tileCol: 3, tileRow: 4 },
    { id: "sofa-3", type: "sofa", tileCol: 4, tileRow: 4 },
    { id: "sofa-4", type: "sofa", tileCol: 6, tileRow: 4 },
  ],
};

let _writeLock = Promise.resolve();

function withLock(fn) {
  const next = _writeLock.then(() => fn());
  _writeLock = next.catch(() => {});
  return next;
}

function loadConfig() {
  try {
    if (!fs.existsSync(OFFICE_FILE)) return DEFAULT_CONFIG;
    const parsed = JSON.parse(fs.readFileSync(OFFICE_FILE, "utf8"));
    if (!parsed || !Array.isArray(parsed.props)) throw new Error("invalid");
    return parsed;
  } catch {
    try {
      fs.renameSync(OFFICE_FILE, OFFICE_FILE + ".bak");
    } catch {}
    console.error("[office-file-store] office.json corrupted - using default");
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config) {
  const tmp = OFFICE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8");
  fs.renameSync(tmp, OFFICE_FILE);
}

function getDeskCount() {
  const config = loadConfig();
  return config.props.filter((p) => p.type === "desk").length;
}

module.exports = {
  withLock,
  loadConfig,
  saveConfig,
  getDeskCount,
};
