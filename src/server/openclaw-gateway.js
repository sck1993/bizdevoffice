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
    this.protocolVersion = 3;
    this.connectRequestId = "clawoffice-connect";
    this.gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
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
    if (msg?.type === "event" && msg?.event === "connect.challenge") {
      this._sendConnectRequest();
      return;
    }

    if (msg?.type === "res" && msg?.id === this.connectRequestId) {
      if (msg?.ok) {
        console.log("[gateway] connect handshake accepted");
      } else {
        console.error(
          "[gateway] connect handshake rejected:",
          JSON.stringify(msg?.error ?? msg?.payload ?? msg)
        );
      }
      return;
    }

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

  _sendConnectRequest() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const params = {
      minProtocol: this.protocolVersion,
      maxProtocol: this.protocolVersion,
      client: {
        id: "cli",
        displayName: "clawoffice-monitor",
        version: "0.1.0",
        platform: "node",
        mode: "cli",
      },
    };

    if (this.gatewayToken) {
      params.auth = {
        token: this.gatewayToken,
      };
    }

    this.ws.send(
      JSON.stringify({
        type: "req",
        id: this.connectRequestId,
        method: "connect",
        params,
      })
    );
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
