const WebSocket = require("ws");
const EventEmitter = require("events");
const { createHash, generateKeyPairSync, randomUUID, sign } = require("crypto");
const fs = require("fs");
const path = require("path");

// Protocol constants — must match OpenClaw gateway schema
const PROTOCOL_MIN = 1;
const PROTOCOL_MAX = 3;
const MODERN_PROTOCOL = 3;
const MODERN_CLIENT_ID = "cli";
const MODERN_CLIENT_MODE = "cli";
const MODERN_ROLE = "operator";
const MODERN_SCOPES = ["operator.read", "operator.write", "operator.admin"];

// Device identity is persisted so the same device ID is reused across restarts.
// Override with DEVICE_IDENTITY_PATH env var and mount as a Docker volume.
const DEVICE_IDENTITY_PATH =
  process.env.DEVICE_IDENTITY_PATH || path.join(process.cwd(), "data", "device.json");

// ── Device identity helpers ──────────────────────────────────────────────────

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateDeviceIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicSpkiDer = publicKey.export({ type: "spki", format: "der" });
  const publicRaw = publicSpkiDer.slice(-32); // raw Ed25519 key is last 32 bytes of SPKI DER
  const deviceId = createHash("sha256").update(publicRaw).digest("hex");
  return {
    id: deviceId,
    publicKey: base64Url(publicRaw),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    createdAt: new Date().toISOString(),
  };
}

function loadOrCreateDeviceIdentity(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (
        parsed &&
        typeof parsed.id === "string" &&
        typeof parsed.publicKey === "string" &&
        typeof parsed.privateKeyPem === "string"
      ) {
        return parsed;
      }
    }
  } catch {
    // fall through and regenerate
  }

  const identity = generateDeviceIdentity();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(identity, null, 2) + "\n", { mode: 0o600 });
  console.log("[gateway] new device identity created:", identity.id);
  return identity;
}

/**
 * Signs the connect challenge with Ed25519.
 * Payload format: "v2|{deviceId}|{clientId}|{mode}|{role}|{scopes}|{ts}|{token}|{nonce}"
 */
function buildDeviceAuth(challenge, token, identity) {
  const nonce = challenge?.nonce;
  const signedAt = challenge?.ts;
  const payload = [
    "v2",
    identity.id,
    MODERN_CLIENT_ID,
    MODERN_CLIENT_MODE,
    MODERN_ROLE,
    MODERN_SCOPES.join(","),
    String(signedAt),
    token || "",
    nonce,
  ].join("|");

  return {
    id: identity.id,
    publicKey: identity.publicKey,
    signature: base64Url(sign(null, Buffer.from(payload), identity.privateKeyPem)),
    signedAt,
    nonce,
  };
}

// ── Gateway class ────────────────────────────────────────────────────────────

class OpenClawGateway extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.reconnectDelay = 5000;
    this.reconnectTimer = null;
    this.shouldReconnect = true;
    this.gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || null;

    this._connectRequestId = null;
    this._connectChallenge = null;
    this._connectSent = false;
    this._connectTimer = null;
    this._deviceIdentity = null;
    this._pending = new Map();
    this._chatStreams = new Map();
    this._sessionQueues = new Map();
    this._sessionGenerations = new Map();
    this._rpcTimeout = 30000;
  }

  connect() {
    if (!this.url) {
      console.warn("[gateway] OPENCLAW_URL not configured — running with dummy agents only.");
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

    this._connectChallenge = null;
    this._connectSent = false;
    this._connectRequestId = null;

    // Origin header required — OpenClaw allows localhost:18789 by default
    this.ws = new WebSocket(this.url, {
      headers: { Origin: "http://localhost:18789" },
    });

    this.ws.on("open", () => {
      console.log("[gateway] connected to OpenClaw");
      this.emit("connected");
      // Wait up to 750 ms for a connect.challenge before falling back to legacy mode
      if (this._connectTimer) clearTimeout(this._connectTimer);
      this._connectTimer = setTimeout(() => {
        this._connectTimer = null;
        if (!this._connectSent) this._sendConnect();
      }, 750);
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleMessage(msg);
      } catch {
        // non-JSON 무시
      }
    });

    this.ws.on("close", () => {
      for (const [id, pending] of this._pending.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Gateway disconnected before response: ${id}`));
      }
      this._pending.clear();
      this._clearChatStreams();
      this._sessionQueues.clear();
      this.ws = null;
      if (this._connectTimer) {
        clearTimeout(this._connectTimer);
        this._connectTimer = null;
      }
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

  _getDeviceIdentity() {
    if (!this._deviceIdentity) {
      this._deviceIdentity = loadOrCreateDeviceIdentity(DEVICE_IDENTITY_PATH);
    }
    return this._deviceIdentity;
  }

  _sendConnect() {
    if (this._connectSent) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this._connectSent = true;
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }

    const id = randomUUID();
    this._connectRequestId = id;

    let params;
    if (this._connectChallenge) {
      // Modern mode: Ed25519 device signature required
      const identity = this._getDeviceIdentity();
      const device = buildDeviceAuth(this._connectChallenge, this.gatewayToken, identity);
      params = {
        minProtocol: MODERN_PROTOCOL,
        maxProtocol: MODERN_PROTOCOL,
        client: {
          id: MODERN_CLIENT_ID,
          version: "1.0.0",
          platform: "node",
          mode: MODERN_CLIENT_MODE,
        },
        role: MODERN_ROLE,
        scopes: MODERN_SCOPES,
        device,
        ...(this.gatewayToken ? { auth: { token: this.gatewayToken } } : {}),
      };
      console.log("[gateway] sending modern connect (device:", device.id.slice(0, 8), "...)");
    } else {
      // Legacy mode: no challenge, use UI client identity
      params = {
        minProtocol: PROTOCOL_MIN,
        maxProtocol: PROTOCOL_MAX,
        client: { id: "openclaw-control-ui", version: "1.0.0", platform: "node", mode: "ui" },
        caps: ["tool-events"],
        scopes: ["operator.admin"],
        ...(this.gatewayToken ? { auth: { token: this.gatewayToken } } : {}),
      };
      console.log("[gateway] sending legacy connect (no challenge received)");
    }

    this.ws.send(JSON.stringify({ type: "req", id, method: "connect", params }));
  }

  _rpcRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(new Error("Gateway not connected"));
      }

      const id = this._sendRequest(method, params);
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, this._rpcTimeout);

      this._pending.set(id, { resolve, reject, timer });
    });
  }

  _sendRequest(method, params, requestId = randomUUID()) {
    if (!this.isConnected()) {
      throw new Error("Gateway not connected");
    }

    this.ws.send(JSON.stringify({ type: "req", id: requestId, method, params }));
    return requestId;
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  chatSend(agentId, baseSessionKey, message, onDelta) {
    const normalizedBase = baseSessionKey.startsWith("agent:")
      ? baseSessionKey
      : `agent:${agentId}:${baseSessionKey}`;
    const tail = this._sessionQueues.get(normalizedBase) ?? Promise.resolve();
    const request = tail.then(
      () => this._executeChatSend(normalizedBase, message, onDelta),
      () => this._executeChatSend(normalizedBase, message, onDelta),
    );

    this._sessionQueues.set(
      normalizedBase,
      request.then(() => {}, () => {}),
    );

    return request;
  }

  _executeChatSend(normalizedBase, message, onDelta) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error("Gateway not connected"));
        return;
      }

      const generation = this._sessionGenerations.get(normalizedBase) ?? 0;
      const sessionKey = generation === 0 ? normalizedBase : `${normalizedBase}:g${generation}`;
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this._chatStreams.delete(sessionKey);
        this._advanceSessionGeneration(normalizedBase, generation);
        reject(new Error("chat.send timeout"));
      }, 180000);

      this._chatStreams.set(sessionKey, {
        normalizedBase,
        generation,
        requestId,
        resolve,
        reject,
        timer,
        onDelta,
        chunks: [],
      });

      try {
        this._sendRequest("chat.send", {
          sessionKey,
          message,
          idempotencyKey: randomUUID(),
        }, requestId);
      } catch (error) {
        clearTimeout(timer);
        this._chatStreams.delete(sessionKey);
        reject(error);
      }
    });
  }

  _clearChatStreams(reason = "Gateway disconnected") {
    for (const [sessionKey, stream] of this._chatStreams.entries()) {
      clearTimeout(stream.timer);
      stream.reject(new Error(reason || `Gateway disconnected before chat completed: ${sessionKey}`));
    }
    this._chatStreams.clear();
  }

  _findChatStreamByRequestId(requestId) {
    for (const [sessionKey, stream] of this._chatStreams.entries()) {
      if (stream.requestId === requestId) {
        return { sessionKey, stream };
      }
    }
    return null;
  }

  _extractChatContent(message, fallbackChunks) {
    const content = message?.content;
    if (Array.isArray(content)) {
      const text = content
        .filter((item) => item?.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("");
      if (text) return text;
    }
    return fallbackChunks.join("");
  }

  _extractChatErrorMessage(payload) {
    const error = payload?.error;
    if (typeof error?.message === "string" && error.message) return error.message;
    if (typeof error === "string" && error) return error;
    if (typeof payload?.errorMessage === "string" && payload.errorMessage) return payload.errorMessage;
    return "chat error";
  }

  _advanceSessionGeneration(normalizedBase, generation) {
    const current = this._sessionGenerations.get(normalizedBase) ?? 0;
    this._sessionGenerations.set(normalizedBase, Math.max(current, generation + 1));
  }

  _handleMessage(msg) {
    // Challenge from server — respond with signed device auth
    if (msg?.type === "event" && msg?.event === "connect.challenge") {
      this._connectChallenge = msg?.payload || null;
      this._connectSent = false;
      if (this._connectTimer) {
        clearTimeout(this._connectTimer);
        this._connectTimer = null;
      }
      this._sendConnect();
      return;
    }

    // Connect response
    if (msg?.type === "res" && msg?.id === this._connectRequestId) {
      this._connectRequestId = null;
      if (msg?.ok) {
        console.log("[gateway] connect handshake accepted");
      } else {
        const errDetail = msg?.error ?? msg?.payload ?? msg;
        console.error("[gateway] connect handshake rejected:", JSON.stringify(errDetail));
        // If pairing is required, log a clear message
        if (errDetail?.code === "PAIRING_REQUIRED" || errDetail?.code === "NOT_PAIRED") {
          console.error(
            "[gateway] device not paired — run: openclaw pair <device-id> on the OpenClaw host.",
            "Device ID:", this._deviceIdentity?.id ?? "(not yet loaded)",
          );
        }
      }
      return;
    }

    if (msg?.type === "res" && this._pending.has(msg.id)) {
      const { resolve, reject, timer } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.ok) resolve(msg.payload ?? msg);
      else reject(new Error(JSON.stringify(msg.error ?? msg)));
      return;
    }

    if (msg?.type === "res") {
      const chatMatch = this._findChatStreamByRequestId(msg.id);
      if (chatMatch) {
        if (!msg.ok) {
          clearTimeout(chatMatch.stream.timer);
          this._chatStreams.delete(chatMatch.sessionKey);
          this._advanceSessionGeneration(
            chatMatch.stream.normalizedBase,
            chatMatch.stream.generation,
          );
          chatMatch.stream.reject(new Error(this._extractChatErrorMessage(msg)));
        }
        return;
      }
    }

    // Keepalive tick — ignore silently
    if (msg?.type === "event" && msg?.event === "tick") {
      return;
    }

    // Health event — emit for agent store sync
    if (msg?.type === "event" && msg?.event === "health") {
      console.log("[gateway] health:", JSON.stringify(msg.payload).slice(0, 300));
      this.emit("health", msg.payload);
      return;
    }

    // Agent activity events
    // payload.stream = "lifecycle" → phase start/end drive working/idle transitions
    // payload.stream = "assistant" → streaming text (agent is working)
    if (msg?.type === "event" && msg?.event === "agent" && msg?.payload) {
      const p = msg.payload;
      const agentId = p.sessionKey?.split(":")?.[1] ?? p.agentId;
      if (agentId) {
        if (p.stream === "lifecycle") {
          if (p.data?.phase === "start") {
            console.log("[gateway] agent working:", agentId, "run:", p.runId);
            this.emit("agent:working", { agentId, taskTitle: p.sessionKey });
          } else if (p.data?.phase === "end") {
            console.log("[gateway] agent idle:", agentId);
            this.emit("agent:idle", { agentId });
          }
        }
        // assistant delta events are frequent — emit working but don't log each one
        if (p.stream === "assistant") {
          if (typeof p.data?.delta === "string" && p.sessionKey) {
            const stream = this._chatStreams.get(p.sessionKey);
            if (stream) {
              stream.chunks.push(p.data.delta);
              stream.onDelta?.(p.data.delta);
            }
          }
          this.emit("agent:working", { agentId, taskTitle: p.sessionKey });
        }
      }
      return;
    }

    if (msg?.type === "event" && msg?.event === "chat" && msg?.payload) {
      const p = msg.payload;
      const stream = p.sessionKey ? this._chatStreams.get(p.sessionKey) : null;
      if (!stream) return;

      if (p.state === "final") {
        clearTimeout(stream.timer);
        this._chatStreams.delete(p.sessionKey);
        stream.resolve(this._extractChatContent(p.message, stream.chunks));
      } else if (p.state === "error") {
        clearTimeout(stream.timer);
        this._chatStreams.delete(p.sessionKey);
        this._advanceSessionGeneration(stream.normalizedBase, stream.generation);
        stream.reject(new Error(this._extractChatErrorMessage(p)));
      }
      return;
    }

    // Heartbeat — suppress noisy logging
    if (msg?.type === "event" && msg?.event === "heartbeat") {
      return;
    }

    // Unrecognised messages — log for discovery
    console.log("[gateway] message:", JSON.stringify(msg));
    this.emit("message", msg);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._clearChatStreams("Gateway disconnected");
    this._sessionQueues.clear();
    if (this.ws) this.ws.close();
  }

  async agentsCreate(agentId, workspace) {
    return this._rpcRequest("agents.create", { name: agentId, workspace });
  }

  async agentsFileSet(agentId, name, content) {
    return this._rpcRequest("agents.files.set", { agentId, name, content });
  }

  async agentsDelete(agentId) {
    return this._rpcRequest("agents.delete", { agentId });
  }
}

module.exports = { OpenClawGateway };
