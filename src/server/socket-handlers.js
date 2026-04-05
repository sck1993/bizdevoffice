const { agentStateStore } = require("./agent-state-store");
const { loadConfig } = require("./office-file-store");

function registerSocketHandlers(io, socket) {
  // 접속 시 전체 스냅샷 전송
  socket.emit("agents:snapshot", {
    agents: agentStateStore.getAll(),
  });
  socket.emit("office:config", loadConfig());
}

module.exports = { registerSocketHandlers };
