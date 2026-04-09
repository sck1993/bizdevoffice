const { agentStateStore } = require("./agent-state-store");
const { loadConfig } = require("./office-file-store");

function registerSocketHandlers(io, socket) {
  // 접속 시 전체 스냅샷 전송
  // office:config를 먼저 보내야 meetingOccupied가 초기화된 상태에서 snapshot 처리 가능
  socket.emit("office:config", loadConfig());
  socket.emit("agents:snapshot", {
    agents: agentStateStore.getAll(),
  });
}

module.exports = { registerSocketHandlers };
