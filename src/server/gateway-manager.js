const { agentStateStore } = require("./agent-state-store");
const { OpenClawGateway } = require("./openclaw-gateway");

const gateway = new OpenClawGateway(process.env.OPENCLAW_URL || "ws://localhost:3000");
let io = null;

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

  gateway.connect();
}

module.exports = { initGateway };
