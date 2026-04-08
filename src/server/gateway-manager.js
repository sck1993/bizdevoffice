const { agentStateStore } = require("./agent-state-store");
const { OpenClawGateway } = require("./openclaw-gateway");
const agentFileStore = require("./agent-file-store");

if (!global.__clawGateway) {
  global.__clawGateway = new OpenClawGateway(process.env.OPENCLAW_URL);
}
const gateway = global.__clawGateway;
let io = null;

function isSelfReferentialGatewayUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const appPort = String(process.env.PORT || 3000);
    const gatewayPort = parsed.port || (parsed.protocol === "wss:" ? "443" : "80");
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

    return localHosts.has(parsed.hostname) && gatewayPort === appPort;
  } catch {
    console.warn("[gateway] OPENCLAW_URL is not a valid URL:", url);
    return false;
  }
}

/**
 * Sync agent store from a health event payload.
 * Adds new agents (idle), leaves existing agents' states untouched.
 * Display name is resolved from file store first, then health payload, then agentId.
 */
function syncAgentsFromHealth(payload) {
  const agents = payload?.agents;
  if (!Array.isArray(agents)) return;

  const saved = agentFileStore.loadAll();
  const savedMap = new Map(saved.map((a) => [a.agentId, a]));

  for (const a of agents) {
    const agentId = a.agentId;
    const fileAgent = savedMap.get(agentId);
    if (!fileAgent) continue; // 커스텀 생성된 에이전트만 표시
    if (!agentStateStore.get(agentId)) {
      const name = fileAgent.name ?? a.name ?? agentId;
      const deskIndex = fileAgent.deskIndex ?? -1;
      const spriteImage = fileAgent.profileImage ?? null;
      const spriteFrames = fileAgent.spriteFrames;
      agentStateStore.set(agentId, { agentId, name, state: "idle", deskIndex, spriteImage, spriteFrames });
      console.log("[gateway] registered agent from health:", agentId, name);
    }
  }
}

function initGateway(socketIo) {
  io = socketIo;

  const saved = agentFileStore.loadAll();
  for (const agent of saved) {
    agentStateStore.set(agent.agentId, {
      agentId: agent.agentId,
      name: agent.name,
      state: "idle",
      deskIndex: agent.deskIndex,
      spriteImage: agent.profileImage ?? null,
      spriteFrames: agent.spriteFrames,
    });
  }

  // Agent state transitions from gateway events
  gateway.on("agent:working", ({ agentId, taskTitle }) => {
    const prev = agentStateStore.get(agentId);
    agentStateStore.updateStatus(agentId, "working", taskTitle);
    // assistant 스트림 delta마다 이벤트가 오므로, 상태/taskTitle이 실제로 바뀔 때만 emit
    if (prev?.state !== "working" || prev?.taskTitle !== taskTitle) {
      io?.emit("agent:state-changed", { agentId, state: "working", taskTitle });
    }
  });

  gateway.on("agent:idle", ({ agentId }) => {
    agentStateStore.updateStatus(agentId, "idle");
    io?.emit("agent:state-changed", { agentId, state: "idle" });
  });

  gateway.on("agent:meeting", ({ agentId }) => {
    agentStateStore.updateStatus(agentId, "meeting");
    io?.emit("agent:state-changed", { agentId, state: "meeting" });
  });

  // Populate agent store from health events (authoritative agent list)
  gateway.on("health", (payload) => {
    syncAgentsFromHealth(payload);
    // Push updated snapshot to all connected clients
    io?.emit("agents:snapshot", { agents: agentStateStore.getAll() });
  });

  if (!process.env.OPENCLAW_URL) {
    console.warn("[gateway] OPENCLAW_URL is not set — using dummy agents.");
    return;
  }

  if (isSelfReferentialGatewayUrl(process.env.OPENCLAW_URL)) {
    console.warn("[gateway] OPENCLAW_URL points at this server — skipping to avoid self-loop.");
    return;
  }

  gateway.connect();
}

module.exports = { initGateway, gateway };
