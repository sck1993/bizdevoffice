const { agentStateStore } = require("./agent-state-store");
const { OpenClawGateway } = require("./openclaw-gateway");

const gateway = new OpenClawGateway(process.env.OPENCLAW_URL);
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

function initGateway(socketIo) {
  io = socketIo;

  // 개발용 더미 에이전트 등록 (실제 agentId로 교체 필요 — Task 10)
  const AGENTS = [
    { agentId: "agent-a", name: "Agent A" },
    { agentId: "agent-b", name: "Agent B" },
    { agentId: "agent-c", name: "Agent C" },
    { agentId: "agent-d", name: "Agent D" },
    { agentId: "agent-e", name: "Agent E" },
  ];
  AGENTS.forEach((a) => agentStateStore.set(a.agentId, { ...a, state: "idle" }));

  gateway.on("agent:working", ({ agentId, taskTitle }) => {
    agentStateStore.updateStatus(agentId, "working", taskTitle);
    io?.emit("agent:state-changed", { agentId, state: "working", taskTitle });
  });

  gateway.on("agent:idle", ({ agentId }) => {
    agentStateStore.updateStatus(agentId, "idle");
    io?.emit("agent:state-changed", { agentId, state: "idle" });
  });

  gateway.on("agent:meeting", ({ agentId }) => {
    agentStateStore.updateStatus(agentId, "meeting");
    io?.emit("agent:state-changed", { agentId, state: "meeting" });
  });

  if (!process.env.OPENCLAW_URL) {
    console.warn("[gateway] OPENCLAW_URL is not set. Using dummy agents until a real websocket endpoint is configured.");
    return;
  }

  if (isSelfReferentialGatewayUrl(process.env.OPENCLAW_URL)) {
    console.warn(
      "[gateway] OPENCLAW_URL points at this app server. Skipping websocket connect to avoid a self-loop."
    );
    return;
  }

  gateway.connect();
}

module.exports = { initGateway };
