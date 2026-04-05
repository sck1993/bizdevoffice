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

    // Keepalive tick — ignore silently
    if (msg?.type === "event" && msg?.event === "tick") {
      return;
    }

    // All other messages — log full payload and emit
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
    if (this.ws) this.ws.close();
  }
}

module.exports = { OpenClawGateway };
