const WebSocket = require("ws");
const EventEmitter = require("events");

class OpenClawGateway extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.reconnectDelay = 5000;
    this.reconnectTimer = null;
    this.shouldReconnect = true;
  }

  connect() {
    if (!this.url) {
      console.warn("[gateway] OPENCLAW_URL is not configured. Running with snapshot-only dummy agents.");
      return;
    }

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      console.log("[gateway] connected to OpenClaw");
      this.emit("connected");
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleMessage(msg);
      } catch {
        // non-JSON 메시지 무시
      }
    });

    this.ws.on("close", () => {
      this.ws = null;
      console.log("[gateway] disconnected — retrying in", this.reconnectDelay, "ms");
      this.emit("disconnected");
      if (!this.shouldReconnect || this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.reconnectDelay);
    });

    this.ws.on("error", (err) => {
      console.error("[gateway] error:", err.message);
    });
  }

  _handleMessage(msg) {
    // OpenClaw 프로토콜 확인 후 아래 이벤트 emit
    // task in_progress 감지 시:
    //   this.emit("agent:working", { agentId, taskTitle })
    // task complete/idle 감지 시:
    //   this.emit("agent:idle", { agentId })
    // meeting 감지 시:
    //   this.emit("agent:meeting", { agentId })
    //
    // ⚠️ 실제 OpenClaw 메시지 포맷은 연결 후 확인 필요.
    //    deskrpg의 openclaw-gateway.js chatStream 파싱 로직 참고.
    console.log("[gateway] message:", JSON.stringify(msg).slice(0, 100));
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) this.ws.close();
  }
}

module.exports = { OpenClawGateway };
