# Agent Creation & Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bizdevoffice UI에서 에이전트 NPC를 이름·역할·성격·프로필 사진으로 직접 생성하고, OpenClaw RPC로 실제 에이전트를 만들어 오피스 씬에 캐릭터로 등장시킨다.

**Architecture:** UI 모달 → REST API → OpenClaw WebSocket RPC(`agents.create` + `agents.files.set`) → `data/agents.json` 저장 → Socket.io 브로드캐스트 → Phaser 씬 스프라이트 스폰. 데스크 배치는 `DESK_SLOTS` 배열(index 기반)로 처리. 삭제는 `agent:removed` Socket.io 이벤트로 씬에서 스프라이트 제거.

**Tech Stack:** Next.js 15 App Router, React 19, Phaser 3, Socket.io 4.x, TypeScript, CommonJS (server 측), Docker Compose

**Spec:** `docs/superpowers/specs/2026-04-05-agent-creation-design.md`

---

## 파일 구조 맵

| 파일 | 변경 | 책임 |
|------|------|------|
| `src/types/agent.ts` | 수정 | `AgentConfig` 타입 추가, `AgentState.deskIndex` 추가 |
| `src/game/config.ts` | 수정 | `DESK_POSITIONS` → `DESK_SLOTS` 교체 |
| `src/game/sprites/AgentSprite.ts` | 수정 | `deskPos` 주입, `getTargetPosition` 수정 |
| `src/game/scenes/OfficeScene.ts` | 수정 | `deskIndex` 기반 슬롯, `agent:removed` 처리 |
| `src/components/GameWrapper.tsx` | 수정 | `agent:removed` Socket.io→EventBus, `AgentPanel` 추가 |
| `server.js` | 수정 | `global.__clawIo = io` 추가 |
| `src/server/agent-state-store.js` | 수정 | `delete(agentId)` 메서드 추가 |
| `src/server/agent-file-store.js` | 신규 | `data/agents.json` CRUD + withLock + atomic write |
| `src/server/openclaw-gateway.js` | 수정 | `_pending`, `_rpcRequest`, RPC 메서드, `isConnected` 추가 |
| `src/server/gateway-manager.js` | 수정 | `global.__clawGateway` 싱글턴, 복원 로직, `gateway` export |
| `src/app/api/agents/route.ts` | 신규 | `GET /api/agents`, `POST /api/agents` |
| `src/app/api/agents/[id]/route.ts` | 신규 | `DELETE /api/agents/[id]` |
| `src/app/api/agents/upload/route.ts` | 신규 | `POST /api/agents/upload` (이미지 업로드) |
| `src/app/api/gateway/status/route.ts` | 신규 | `GET /api/gateway/status` |
| `src/components/AgentPanel.tsx` | 신규 | 사이드패널 + 생성 모달 |
| `docker-compose.yml` | 수정 | `clawoffice_uploads` 볼륨 추가 |
| `.env.local` | 수정 | `OPENCLAW_WORKSPACE_ROOT` 추가 |

---

## Task 1: 타입 정의 + config 기반 교체

**Files:**
- Modify: `src/types/agent.ts`
- Modify: `src/game/config.ts`

- [ ] **Step 1: `AgentState`에 `deskIndex` 추가, `AgentConfig` 타입 신규 추가**

`src/types/agent.ts`를 다음으로 교체:

```ts
export type AgentStatus = "idle" | "working" | "meeting";

export interface AgentState {
  agentId: string;
  name: string;
  state: AgentStatus;
  taskTitle?: string;
  deskIndex?: number; // -1 = 데스크 없음, 0~3 = 슬롯 index
}

export interface AgentsSnapshot {
  agents: AgentState[];
}

export interface AgentStateChanged {
  agentId: string;
  state: AgentStatus;
  taskTitle?: string;
}

export interface AgentConfig {
  agentId: string;
  name: string;
  identity: string;
  soul: string;
  profileImage: string | null;
  deskIndex: number; // -1 = 데스크 없음
  createdAt: string;
}
```

- [ ] **Step 2: `config.ts`의 `DESK_POSITIONS` → `DESK_SLOTS`로 교체**

`src/game/config.ts`를 다음으로 교체:

```ts
// 게임 캔버스 기준 해상도
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 640;

// Row 1 / Row 2 경계 Y 좌표
export const ROW_BOUNDARY_Y = GAME_HEIGHT * 0.52; // 333px

// 에이전트 데스크 슬롯 (index 0~3, deskIndex로 참조)
export const DESK_SLOTS: { x: number; y: number }[] = [
  { x: 160, y: 210 },
  { x: 320, y: 210 },
  { x: 160, y: 295 },
  { x: 320, y: 295 },
];

// 미팅 테이블 좌석 (최대 5개)
export const MEETING_SEATS: { x: number; y: number }[] = [
  { x: 850, y: 195 },
  { x: 950, y: 195 },
  { x: 850, y: 265 },
  { x: 950, y: 265 },
  { x: 900, y: 230 },
];

// 라운지 소파 위치 (idle 에이전트 배치)
export const LOUNGE_SEATS: { x: number; y: number }[] = [
  { x: 130, y: 520 },
  { x: 220, y: 520 },
  { x: 420, y: 520 },
  { x: 510, y: 520 },
  { x: 700, y: 520 },
];
```

- [ ] **Step 3: TypeScript 빌드 오류 확인**

```bash
npx tsc --noEmit
```

`AgentSprite.ts`에서 `DESK_POSITIONS` 참조 오류 발생 예상 → 다음 Task에서 수정.

- [ ] **Step 4: 커밋**

```bash
git add src/types/agent.ts src/game/config.ts
git commit -m "refactor: replace DESK_POSITIONS with DESK_SLOTS, add AgentConfig type"
```

---

## Task 2: AgentSprite + OfficeScene 수정 (deskPos 주입 + agent:removed)

**Files:**
- Modify: `src/game/sprites/AgentSprite.ts`
- Modify: `src/game/scenes/OfficeScene.ts`

- [ ] **Step 1: `AgentSprite`에 `deskPos` 주입**

`src/game/sprites/AgentSprite.ts`를 다음으로 교체:

```ts
import * as Phaser from "phaser";
import { AgentStatus } from "../../types/agent";
import { LOUNGE_SEATS, MEETING_SEATS } from "../config";

interface AgentSpriteConfig {
  scene: Phaser.Scene;
  agentId: string;
  name: string;
  initialStatus: AgentStatus;
  loungeIndex: number;
  deskPos?: { x: number; y: number }; // 생성 시 주입, 없으면 라운지 배치
}

export class AgentSprite extends Phaser.GameObjects.Sprite {
  agentId: string;
  agentName: string;
  currentStatus: AgentStatus;
  private loungeIndex: number;
  private deskPos: { x: number; y: number } | undefined;
  private tooltip: Phaser.GameObjects.Text;
  private label: Phaser.GameObjects.Text;
  private meetingSeatIndex = -1;
  private taskTitle?: string;

  constructor(config: AgentSpriteConfig) {
    const loungePos = LOUNGE_SEATS[config.loungeIndex] ?? LOUNGE_SEATS[0];
    super(config.scene, loungePos.x, loungePos.y, "character", 0);

    this.agentId = config.agentId;
    this.agentName = config.name;
    this.currentStatus = config.initialStatus;
    this.loungeIndex = config.loungeIndex;
    this.deskPos = config.deskPos;

    config.scene.add.existing(this as unknown as Phaser.GameObjects.GameObject);
    this.setInteractive();

    this.label = config.scene.add.text(this.x, this.y - 50, config.name, {
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#00000088",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5);

    this.tooltip = config.scene.add.text(this.x, this.y - 70, "", {
      fontSize: "11px",
      color: "#ffffcc",
      backgroundColor: "#333333cc",
      padding: { x: 6, y: 3 },
      wordWrap: { width: 200 },
    }).setOrigin(0.5).setVisible(false);

    this.on("pointerdown", () => this.showTooltip());
    config.scene.input.on("pointerdown", (_: unknown, gameObjects: Phaser.GameObjects.GameObject[]) => {
      if (!gameObjects.includes(this as unknown as Phaser.GameObjects.GameObject)) this.hideTooltip();
    });
  }

  private showTooltip() {
    if (!this.taskTitle) return;
    this.tooltip.setText(this.taskTitle);
    this.tooltip.setVisible(true);
  }

  private hideTooltip() {
    this.tooltip.setVisible(false);
  }

  private getTargetPosition(): { x: number; y: number } {
    switch (this.currentStatus) {
      case "working":
        return this.deskPos ?? LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
      case "meeting":
        return MEETING_SEATS[this.meetingSeatIndex] ?? LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
      default:
        return LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
    }
  }

  setAgentState(
    status: AgentStatus,
    opts: { taskTitle?: string; meetingSeatIndex?: number } = {}
  ) {
    this.currentStatus = status;
    this.taskTitle = opts.taskTitle;
    if (opts.meetingSeatIndex !== undefined) {
      this.meetingSeatIndex = opts.meetingSeatIndex;
    }
    this.hideTooltip();
    this.moveToTarget();
  }

  private moveToTarget() {
    const target = this.getTargetPosition();
    this.scene.tweens.add({
      targets: [this, this.label, this.tooltip],
      x: target.x,
      y: target.y,
      duration: 1000,
      ease: "Power2",
      onUpdate: () => {
        this.label.setPosition(this.x, this.y - 50);
        this.tooltip.setPosition(this.x, this.y - 70);
      },
      onComplete: () => {
        this.playAnimation();
      },
    });
  }

  private playAnimation() {
    const animKey = `agent_${this.currentStatus}`;
    if (this.anims.exists(animKey)) {
      this.play(animKey, true);
    }
  }

  dim(active: boolean) {
    this.setAlpha(active ? 0.4 : 1.0);
    this.label.setAlpha(active ? 0.4 : 1.0);
  }

  destroy(fromScene?: boolean) {
    this.label.destroy();
    this.tooltip.destroy();
    super.destroy(fromScene);
  }
}
```

- [ ] **Step 2: `OfficeScene`에 `deskIndex` 기반 슬롯 조회 + `agent:removed` 처리 추가**

`src/game/scenes/OfficeScene.ts`를 다음으로 교체:

```ts
import * as Phaser from "phaser";
import { EventBus } from "../EventBus";
import { GAME_HEIGHT, GAME_WIDTH, MEETING_SEATS, DESK_SLOTS } from "../config";
import { AgentSprite } from "../sprites/AgentSprite";
import type { AgentState, AgentStateChanged, AgentsSnapshot } from "../../types/agent";

export class OfficeScene extends Phaser.Scene {
  private agents = new Map<string, AgentSprite>();
  private meetingOccupied: (string | null)[] = MEETING_SEATS.map(() => null);

  constructor() {
    super({ key: "OfficeScene" });
  }

  preload() {
    this.load.image("background", "/assets/background/office.png");
    this.load.spritesheet("character", "/assets/characters/agent.png", {
      frameWidth: 96,
      frameHeight: 96,
    });
  }

  create() {
    this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "background")
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    this.registerAnimations();

    const handleSnapshot = (data: unknown) => {
      const { agents } = data as AgentsSnapshot;
      agents.forEach((agent, index) => this.spawnAgent(agent, index));
    };

    const handleStateChanged = (data: unknown) => {
      const { agentId, state, taskTitle } = data as AgentStateChanged;
      const sprite = this.agents.get(agentId);
      if (!sprite) return;

      let meetingSeatIndex = -1;
      if (state === "meeting") {
        meetingSeatIndex = this.claimMeetingSeat(agentId);
      } else {
        this.releaseMeetingSeat(agentId);
      }

      sprite.setAgentState(state, { taskTitle, meetingSeatIndex });
    };

    const handleAgentRemoved = ({ agentId }: { agentId: string }) => {
      const sprite = this.agents.get(agentId);
      if (!sprite) return;
      this.releaseMeetingSeat(agentId);
      sprite.destroy();
      this.agents.delete(agentId);
    };

    const handleConnectionLost = () => {
      this.agents.forEach((sprite) => sprite.dim(true));
    };

    const handleConnectionRestored = () => {
      this.agents.forEach((sprite) => sprite.dim(false));
    };

    EventBus.on("agents:snapshot", handleSnapshot);
    EventBus.on("agent:state-changed", handleStateChanged);
    EventBus.on("agent:removed", handleAgentRemoved);
    EventBus.on("connection:lost", handleConnectionLost);
    EventBus.on("connection:restored", handleConnectionRestored);

    this.events.once("shutdown", () => {
      EventBus.off("agents:snapshot", handleSnapshot);
      EventBus.off("agent:state-changed", handleStateChanged);
      EventBus.off("agent:removed", handleAgentRemoved);
      EventBus.off("connection:lost", handleConnectionLost);
      EventBus.off("connection:restored", handleConnectionRestored);
    });
  }

  private registerAnimations() {
    const texture = this.textures.get("character");
    const numericFrames = texture
      .getFrameNames()
      .filter((name) => name !== "__BASE")
      .map((name) => Number(name))
      .filter((name) => Number.isFinite(name))
      .sort((a, b) => a - b);

    const fallbackFrame = numericFrames[0] ?? 0;

    this.createAnimation("agent_idle", numericFrames.filter((frame) => frame >= 0 && frame <= 3), fallbackFrame, 6);
    this.createAnimation("agent_working", numericFrames.filter((frame) => frame >= 4 && frame <= 7), fallbackFrame, 8);
    this.createAnimation("agent_meeting", numericFrames.filter((frame) => frame >= 8 && frame <= 11), fallbackFrame, 6);
  }

  private createAnimation(key: string, frames: number[], fallbackFrame: number, frameRate: number) {
    if (this.anims.exists(key)) return;

    const safeFrames = (frames.length > 0 ? frames : [fallbackFrame]).map((frame) => ({
      key: "character",
      frame,
    }));

    this.anims.create({ key, frames: safeFrames, frameRate, repeat: -1 });
  }

  private spawnAgent(state: AgentState, index: number) {
    if (this.agents.has(state.agentId)) return;

    const deskPos =
      state.deskIndex != null && state.deskIndex >= 0
        ? DESK_SLOTS[state.deskIndex]
        : undefined;

    const sprite = new AgentSprite({
      scene: this,
      agentId: state.agentId,
      name: state.name,
      initialStatus: state.state,
      loungeIndex: index % 5,
      deskPos,
    });

    this.agents.set(state.agentId, sprite);

    const meetingSeatIndex = state.state === "meeting" ? this.claimMeetingSeat(state.agentId) : -1;
    sprite.setAgentState(state.state, { taskTitle: state.taskTitle, meetingSeatIndex });
  }

  private claimMeetingSeat(agentId: string): number {
    const existing = this.meetingOccupied.indexOf(agentId);
    if (existing !== -1) return existing;

    const empty = this.meetingOccupied.indexOf(null);
    if (empty !== -1) {
      this.meetingOccupied[empty] = agentId;
      return empty;
    }

    return -1;
  }

  private releaseMeetingSeat(agentId: string) {
    const index = this.meetingOccupied.indexOf(agentId);
    if (index !== -1) this.meetingOccupied[index] = null;
  }
}
```

- [ ] **Step 3: 빌드 오류 없음 확인**

```bash
npx tsc --noEmit
```

오류 없으면 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/game/sprites/AgentSprite.ts src/game/scenes/OfficeScene.ts
git commit -m "refactor: inject deskPos into AgentSprite, add agent:removed handling in OfficeScene"
```

---

## Task 3: 서버 기반 — server.js + agent-state-store

**Files:**
- Modify: `server.js`
- Modify: `src/server/agent-state-store.js`

- [ ] **Step 1: `server.js`에 `global.__clawIo` 추가**

`server.js`의 `initGateway(io);` 바로 위에 한 줄 추가:

```js
  global.__clawIo = io;
  initGateway(io);
```

- [ ] **Step 2: `agent-state-store.js`에 `delete` 메서드 추가**

`src/server/agent-state-store.js`의 `resetAll()` 메서드 뒤에 추가:

```js
  delete(agentId) {
    this.states.delete(agentId);
  }
```

- [ ] **Step 3: 서버 재시작 후 정상 동작 확인**

```bash
npm run dev
```

브라우저에서 `http://localhost:3000` 접속 → 오피스 씬 정상 표시 확인.

- [ ] **Step 4: 커밋**

```bash
git add server.js src/server/agent-state-store.js
git commit -m "feat: expose io as global.__clawIo, add delete method to AgentStateStore"
```

---

## Task 4: agent-file-store.js 신규 생성

**Files:**
- Create: `src/server/agent-file-store.js`

- [ ] **Step 1: `agent-file-store.js` 작성**

`src/server/agent-file-store.js` 생성:

```js
const fs = require("fs");
const path = require("path");

const AGENTS_FILE = path.join(process.cwd(), "data", "agents.json");
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

// 시작 시 필요한 디렉토리 보장
fs.mkdirSync(path.dirname(AGENTS_FILE), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// in-process 뮤텍스 (동시 쓰기 직렬화)
let _writeLock = Promise.resolve();

function withLock(fn) {
  const next = _writeLock.then(() => fn());
  _writeLock = next.catch(() => {});
  return next;
}

function loadAll() {
  try {
    if (!fs.existsSync(AGENTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(AGENTS_FILE, "utf8"));
  } catch {
    // 손상된 파일은 백업 후 빈 배열로 복구
    try {
      fs.renameSync(AGENTS_FILE, AGENTS_FILE + ".bak");
    } catch {}
    console.error("[agent-file-store] agents.json corrupted — reset to empty");
    return [];
  }
}

function saveAll(agents) {
  const tmp = AGENTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(agents, null, 2), "utf8");
  fs.renameSync(tmp, AGENTS_FILE); // atomic on same filesystem
}

/**
 * agentId slug 생성. CJK 등 ASCII 외 문자는 제거 후 "agent" fallback.
 * 중복 시 -2, -3 ... suffix 자동 부여.
 */
function toAgentId(name, existingIds) {
  const slug =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "agent";

  let candidate = slug;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${slug}-${counter++}`;
  }
  return candidate;
}

module.exports = { loadAll, saveAll, withLock, toAgentId, UPLOADS_DIR };
```

- [ ] **Step 2: 모듈 로드 확인**

```bash
node -e "const s = require('./src/server/agent-file-store'); console.log(s.loadAll());"
```

`[]` 출력되면 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/server/agent-file-store.js
git commit -m "feat: add agent-file-store with JSON persistence, mutex, and atomic write"
```

---

## Task 5: openclaw-gateway.js — RPC 송신 지원 추가

**Files:**
- Modify: `src/server/openclaw-gateway.js`

- [ ] **Step 1: `constructor`에 `_pending` / `_rpcTimeout` 추가**

`constructor(url)` 내부의 `this._deviceIdentity = null;` 줄 뒤에 추가:

```js
    this._pending = new Map(); // id → { resolve, reject, timer }
    this._rpcTimeout = 30000;
```

- [ ] **Step 2: `isConnected` 메서드 추가**

`connect()` 메서드 바로 앞에 추가:

```js
  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
```

- [ ] **Step 3: `_rpcRequest` 메서드 추가**

`_getDeviceIdentity()` 메서드 바로 앞에 추가:

```js
  _rpcRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(new Error("Gateway not connected"));
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, this._rpcTimeout);
      this._pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }
```

- [ ] **Step 4: `_handleMessage`에 pending 응답 처리 추가**

`_handleMessage(msg)` 내부에서 connect response 처리 블록 바로 뒤에 추가:

```js
    // Pending RPC 응답 처리
    if (msg?.type === "res" && this._pending.has(msg.id)) {
      const { resolve, reject, timer } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.ok) resolve(msg.payload ?? msg);
      else reject(new Error(JSON.stringify(msg.error ?? msg)));
      return;
    }
```

- [ ] **Step 5: RPC 메서드 3개 추가**

`disconnect()` 메서드 바로 앞에 추가:

```js
  // agentsCreate: OpenClaw는 name 필드를 agentId로 사용한다
  async agentsCreate(agentId, workspace) {
    return this._rpcRequest("agents.create", { name: agentId, workspace });
  }

  async agentsFileSet(agentId, name, content) {
    return this._rpcRequest("agents.files.set", { agentId, name, content });
  }

  async agentsDelete(agentId) {
    return this._rpcRequest("agents.delete", { agentId });
  }
```

- [ ] **Step 6: 서버 재시작 후 오류 없음 확인**

```bash
npm run dev
```

콘솔에서 에러 없이 `[gateway] connected to OpenClaw` 출력되면 성공.

- [ ] **Step 7: 커밋**

```bash
git add src/server/openclaw-gateway.js
git commit -m "feat: add RPC send support to OpenClawGateway (_rpcRequest, agentsCreate, agentsFileSet, agentsDelete)"
```

---

## Task 6: gateway-manager.js — 싱글턴 + 복원 로직 + gateway export

**Files:**
- Modify: `src/server/gateway-manager.js`

- [ ] **Step 1: `gateway-manager.js` 전체 교체**

```js
const { agentStateStore } = require("./agent-state-store");
const { loadAll } = require("./agent-file-store");
const { OpenClawGateway } = require("./openclaw-gateway");

// Next.js dev hot-reload 시 모듈 캐시가 무효화될 수 있으므로 global에 싱글턴 유지
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

function syncAgentsFromHealth(payload) {
  const agents = payload?.agents;
  if (!Array.isArray(agents)) return;

  for (const a of agents) {
    const agentId = a.agentId;
    const name = a.name ?? agentId;
    if (!agentStateStore.get(agentId)) {
      agentStateStore.set(agentId, { agentId, name, state: "idle", deskIndex: -1 });
      console.log("[gateway] registered agent from health:", agentId, name);
    }
  }
}

function initGateway(socketIo) {
  io = socketIo;

  // data/agents.json에서 저장된 에이전트 복원
  const saved = loadAll();
  for (const agent of saved) {
    agentStateStore.set(agent.agentId, {
      agentId: agent.agentId,
      name: agent.name,
      state: "idle",
      deskIndex: agent.deskIndex,
    });
    console.log("[gateway] restored agent from file:", agent.agentId);
  }

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

  gateway.on("health", (payload) => {
    syncAgentsFromHealth(payload);
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
```

> **주의:** 기존 `const gateway = new OpenClawGateway(process.env.OPENCLAW_URL);` 줄이 제거되고 global 싱글턴으로 교체됨.

- [ ] **Step 2: 서버 재시작 후 복원 로그 확인**

```bash
npm run dev
```

`data/agents.json`이 없으면 복원 로그 없음 (정상). 있으면 `[gateway] restored agent from file: ...` 출력.

- [ ] **Step 3: 커밋**

```bash
git add src/server/gateway-manager.js
git commit -m "feat: gateway-manager uses global singleton, restores agents from JSON on startup"
```

---

## Task 7: API Routes — GET + POST /api/agents

**Files:**
- Create: `src/app/api/agents/route.ts`

- [ ] **Step 1: `src/app/api/agents/route.ts` 작성**

```ts
import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { gateway } = require("../../../../server/gateway-manager");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadAll, saveAll, withLock, toAgentId } = require("../../../../server/agent-file-store");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { agentStateStore } = require("../../../../server/agent-state-store");

const WORKSPACE_ROOT = process.env.OPENCLAW_WORKSPACE_ROOT ?? "~/.openclaw/workspaces";

export async function GET() {
  const agents = loadAll();
  return NextResponse.json({ agents });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body?.name || !body?.identity || !body?.soul) {
    return NextResponse.json({ error: "name, identity, soul are required" }, { status: 400 });
  }

  if (!gateway.isConnected()) {
    return NextResponse.json({ error: "OpenClaw gateway not connected" }, { status: 503 });
  }

  try {
    const result = await withLock(async () => {
      const existing: { agentId: string }[] = loadAll();
      const existingIds = new Set(existing.map((a: { agentId: string }) => a.agentId));

      const agentId = toAgentId(body.name, existingIds);
      const workspace = `${WORKSPACE_ROOT}/${agentId}`;

      // 1. OpenClaw에 에이전트 생성
      try {
        await gateway.agentsCreate(agentId, workspace);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("timeout") ? 504 : 502;
        throw Object.assign(new Error(msg), { status });
      }

      // 2. IDENTITY.md 설정
      try {
        await gateway.agentsFileSet(agentId, "IDENTITY.md", body.identity);
      } catch (err: unknown) {
        await gateway.agentsDelete(agentId).catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("timeout") ? 504 : 502;
        throw Object.assign(new Error(msg), { status });
      }

      // 3. SOUL.md 설정
      try {
        await gateway.agentsFileSet(agentId, "SOUL.md", body.soul);
      } catch (err: unknown) {
        await gateway.agentsDelete(agentId).catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("timeout") ? 504 : 502;
        throw Object.assign(new Error(msg), { status });
      }

      // 4. 빈 데스크 슬롯 배정
      const usedSlots = new Set(existing.map((a: { deskIndex: number }) => a.deskIndex));
      let deskIndex = -1;
      for (let i = 0; i < 4; i++) {
        if (!usedSlots.has(i)) { deskIndex = i; break; }
      }

      const newAgent = {
        agentId,
        name: body.name,
        identity: body.identity,
        soul: body.soul,
        profileImage: body.profileImage ?? null,
        deskIndex,
        createdAt: new Date().toISOString(),
      };

      // 5. JSON 저장
      saveAll([...existing, newAgent]);

      return newAgent;
    });

    // 6. agentStateStore 등록 + 브로드캐스트 (뮤텍스 밖에서 실행)
    agentStateStore.set(result.agentId, {
      agentId: result.agentId,
      name: result.name,
      state: "idle",
      deskIndex: result.deskIndex,
    });

    const io = global.__clawIo;
    io?.emit("agents:snapshot", { agents: agentStateStore.getAll() });

    return NextResponse.json({ agent: result }, { status: 201 });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 2: GET 동작 확인**

서버 실행 후:

```bash
curl http://localhost:3000/api/agents
```

`{"agents":[]}` 반환되면 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/agents/route.ts
git commit -m "feat: add GET /api/agents and POST /api/agents endpoints"
```

---

## Task 8: API Route — DELETE /api/agents/[id]

**Files:**
- Create: `src/app/api/agents/[id]/route.ts`

- [ ] **Step 1: `src/app/api/agents/[id]/route.ts` 작성**

```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { gateway } = require("../../../../../server/gateway-manager");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadAll, saveAll, withLock } = require("../../../../../server/agent-file-store");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { agentStateStore } = require("../../../../../server/agent-state-store");

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;

  let found = false;

  await withLock(async () => {
    const existing = loadAll();
    const target = existing.find((a: { agentId: string }) => a.agentId === agentId);
    if (!target) return;
    found = true;

    // OpenClaw에서 삭제 (실패해도 로컬 삭제 진행)
    await gateway.agentsDelete(agentId).catch((err: unknown) => {
      console.warn("[api/agents] agentsDelete RPC failed:", err);
    });

    saveAll(existing.filter((a: { agentId: string }) => a.agentId !== agentId));

    // 프로필 이미지 파일 삭제
    if (target.profileImage) {
      const imgPath = path.join(process.cwd(), "public", target.profileImage);
      fs.unlink(imgPath, (err) => {
        if (err) console.warn("[api/agents] profileImage delete failed:", err.message);
      });
    }
  });

  if (!found) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  agentStateStore.delete(agentId);

  const io = global.__clawIo;
  io?.emit("agent:removed", { agentId });

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: DELETE 동작 확인**

```bash
curl -X DELETE http://localhost:3000/api/agents/nonexistent-id
```

존재하지 않는 ID는 404, 존재하는 ID는 204 반환 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/agents/[id]/route.ts
git commit -m "feat: add DELETE /api/agents/[id] endpoint"
```

---

## Task 9: API Route — 이미지 업로드 + gateway/status

**Files:**
- Create: `src/app/api/agents/upload/route.ts`
- Create: `src/app/api/gateway/status/route.ts`

- [ ] **Step 1: `src/app/api/agents/upload/route.ts` 작성**

```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UPLOADS_DIR } = require("../../../../../server/agent-file-store");

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only jpeg, png, webp allowed" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 2MB)" }, { status: 413 });
  }

  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const filename = `${randomUUID()}.${ext}`;
  const destPath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(destPath, buffer);

  return NextResponse.json({ url: `/uploads/${filename}` });
}
```

- [ ] **Step 2: `src/app/api/gateway/status/route.ts` 작성**

```ts
import { NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { gateway } = require("../../../../server/gateway-manager");

export async function GET() {
  return NextResponse.json({ connected: gateway.isConnected() });
}
```

- [ ] **Step 3: 동작 확인**

```bash
curl http://localhost:3000/api/gateway/status
```

`{"connected":true}` 또는 `{"connected":false}` 반환되면 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/agents/upload/route.ts src/app/api/gateway/status/route.ts
git commit -m "feat: add image upload and gateway status API endpoints"
```

---

## Task 10: GameWrapper — agent:removed 연결 + AgentPanel 레이아웃

**Files:**
- Modify: `src/components/GameWrapper.tsx`

- [ ] **Step 1: `GameWrapper.tsx`에 `agent:removed` 이벤트 + `AgentPanel` 추가**

`src/components/GameWrapper.tsx`를 다음으로 교체:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import { DisconnectBanner } from "./DisconnectBanner";
import { EventBus } from "../game/EventBus";
import { AgentPanel } from "./AgentPanel";

export function GameWrapper() {
  const gameRef = useRef<HTMLDivElement>(null);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    let disposed = false;
    let socket: Socket | null = null;
    let game: import("phaser").Game | null = null;

    const init = async () => {
      const Phaser = await import("phaser");
      const { GAME_HEIGHT, GAME_WIDTH } = await import("../game/config");
      const { OfficeScene } = await import("../game/scenes/OfficeScene");

      if (disposed || !gameRef.current) return;

      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent: gameRef.current,
        backgroundColor: "#121722",
        scene: [OfficeScene],
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      });

      socket = io();

      socket.on("connect", () => {
        console.log("[socket] connected", socket?.id);
        setDisconnected(false);
        EventBus.emit("connection:restored");
      });

      socket.on("disconnect", (reason) => {
        console.log("[socket] disconnected", reason);
        setDisconnected(true);
        EventBus.emit("connection:lost");
      });

      socket.on("agents:snapshot", (data) => {
        console.log("[socket] agents:snapshot", data);
        EventBus.emit("agents:snapshot", data);
      });

      socket.on("agent:state-changed", (data) => {
        console.log("[socket] agent:state-changed", data);
        EventBus.emit("agent:state-changed", data);
      });

      socket.on("agent:removed", (data) => {
        console.log("[socket] agent:removed", data);
        EventBus.emit("agent:removed", data);
      });
    };

    void init();

    return () => {
      disposed = true;
      socket?.disconnect();
      game?.destroy(true);
    };
  }, []);

  return (
    <>
      <DisconnectBanner visible={disconnected} />
      <div
        style={{
          width: "100%",
          maxWidth: 1560,
          margin: "0 auto",
          borderRadius: 28,
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
          display: "flex",
          alignItems: "flex-start",
        }}
      >
        <div ref={gameRef} style={{ flex: "0 0 auto" }} />
        <AgentPanel />
      </div>
    </>
  );
}
```

- [ ] **Step 2: 빌드 오류 없음 확인**

```bash
npx tsc --noEmit
```

`AgentPanel` import 오류 발생 예상 → 다음 Task에서 생성.

- [ ] **Step 3: 커밋 (AgentPanel 생성 후 함께)**

다음 Task와 함께 커밋.

---

## Task 11: AgentPanel 컴포넌트

**Files:**
- Create: `src/components/AgentPanel.tsx`

- [ ] **Step 1: `AgentPanel.tsx` 작성**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import type { AgentConfig, AgentState } from "../types/agent";

type MergedAgent = AgentConfig & { state: string; taskTitle?: string };

export function AgentPanel() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [states, setStates] = useState<AgentState[]>([]);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AgentConfig + AgentState merge
  const merged: MergedAgent[] = configs.map((c) => {
    const s = states.find((st) => st.agentId === c.agentId);
    return { ...c, state: s?.state ?? "idle", taskTitle: s?.taskTitle };
  });

  // 초기 로드
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => setConfigs(data.agents ?? []));
  }, []);

  // Socket.io 이벤트로 상태 갱신
  useEffect(() => {
    const onSnapshot = (data: { agents: AgentState[] }) => {
      setStates(data.agents);
    };
    const onRemoved = ({ agentId }: { agentId: string }) => {
      setConfigs((prev) => prev.filter((c) => c.agentId !== agentId));
      setStates((prev) => prev.filter((s) => s.agentId !== agentId));
    };

    EventBus.on("agents:snapshot", onSnapshot);
    EventBus.on("agent:removed", onRemoved);
    return () => {
      EventBus.off("agents:snapshot", onSnapshot);
      EventBus.off("agent:removed", onRemoved);
    };
  }, []);

  // Gateway 연결 상태 polling (5초)
  useEffect(() => {
    const check = () =>
      fetch("/api/gateway/status")
        .then((r) => r.json())
        .then((d) => setGatewayConnected(d.connected ?? false))
        .catch(() => setGatewayConnected(false));

    check();
    pollRef.current = setInterval(check, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleDelete = useCallback(async (agentId: string) => {
    await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
    // agent:removed 이벤트로 자동 갱신
  }, []);

  return (
    <div style={{
      width: 220,
      minHeight: "100%",
      background: "#1a1f2e",
      borderLeft: "1px solid #2a3044",
      padding: "16px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      color: "#e0e0e0",
      fontFamily: "monospace",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#7eb8f7", marginBottom: 4 }}>
        Agents
      </div>

      {merged.map((agent) => (
        <div key={agent.agentId} style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 4px",
          borderRadius: 6,
          background: "#232840",
        }}>
          {agent.profileImage ? (
            <img
              src={agent.profileImage}
              alt={agent.name}
              style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "#3a4060", display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: 16,
            }}>🤖</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {agent.name}
            </div>
            <div style={{ fontSize: 10, color: agent.state === "working" ? "#7ef77e" : "#888" }}>
              {agent.state === "working" && agent.taskTitle
                ? agent.taskTitle.slice(0, 20)
                : agent.state}
            </div>
          </div>
          <button
            onClick={() => handleDelete(agent.agentId)}
            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14 }}
            title="삭제"
          >✕</button>
        </div>
      ))}

      {merged.length === 0 && (
        <div style={{ fontSize: 11, color: "#555", textAlign: "center", marginTop: 8 }}>
          에이전트 없음
        </div>
      )}

      <div style={{ flex: 1 }} />

      <button
        onClick={() => setShowModal(true)}
        style={{
          background: "#3a5ab8",
          border: "none",
          color: "#fff",
          borderRadius: 6,
          padding: "8px 0",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        + 에이전트 추가
      </button>

      {showModal && (
        <AgentCreateModal
          gatewayConnected={gatewayConnected}
          onClose={() => setShowModal(false)}
          onCreated={(agent) => setConfigs((prev) => [...prev, agent])}
        />
      )}
    </div>
  );
}

function AgentCreateModal({
  gatewayConnected,
  onClose,
  onCreated,
}: {
  gatewayConnected: boolean;
  onClose: () => void;
  onCreated: (agent: AgentConfig) => void;
}) {
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [soul, setSoul] = useState("");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/agents/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);
    if (res.ok) setProfileImage(data.url);
    else setError(data.error ?? "업로드 실패");
  };

  const handleSubmit = async () => {
    if (!name.trim() || !identity.trim() || !soul.trim()) {
      setError("이름, 역할, 성격을 모두 입력해주세요");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, identity, soul, profileImage }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      onCreated(data.agent);
      onClose();
    } else {
      setError(data.error ?? "생성 실패");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000aa",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "#1a1f2e", borderRadius: 12, padding: 24,
        width: 360, display: "flex", flexDirection: "column", gap: 12,
        border: "1px solid #2a3044", color: "#e0e0e0",
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#7eb8f7" }}>새 에이전트 추가</div>

        <label style={{ fontSize: 12 }}>
          프로필 사진
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile}
            style={{ display: "block", marginTop: 4, color: "#aaa" }} />
          {uploading && <span style={{ fontSize: 11, color: "#888" }}> 업로드 중...</span>}
          {profileImage && <img src={profileImage} alt="" style={{ width: 48, height: 48, borderRadius: "50%", marginTop: 4 }} />}
        </label>

        <label style={{ fontSize: 12 }}>
          이름
          <input value={name} onChange={(e) => setName(e.target.value)}
            style={inputStyle} placeholder="Alice" />
        </label>

        <label style={{ fontSize: 12 }}>
          역할 (Identity)
          <textarea value={identity} onChange={(e) => setIdentity(e.target.value)}
            rows={3} style={inputStyle} placeholder="당신은 프론트엔드 개발자입니다..." />
        </label>

        <label style={{ fontSize: 12 }}>
          성격 (Soul)
          <textarea value={soul} onChange={(e) => setSoul(e.target.value)}
            rows={3} style={inputStyle} placeholder="완벽주의적이고 조용하지만..." />
        </label>

        {!gatewayConnected && (
          <div style={{ fontSize: 11, color: "#f7a07e", background: "#3a2020", borderRadius: 4, padding: "4px 8px" }}>
            ⚠️ OpenClaw 미연결 — 생성 불가
          </div>
        )}

        {error && (
          <div style={{ fontSize: 11, color: "#f77e7e" }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button onClick={onClose} style={btnSecondary}>취소</button>
          <button
            onClick={handleSubmit}
            disabled={!gatewayConnected || loading || uploading}
            style={{ ...btnPrimary, opacity: (!gatewayConnected || loading) ? 0.5 : 1 }}
          >
            {loading ? "생성 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 4,
  background: "#232840", border: "1px solid #2a3044",
  borderRadius: 4, padding: "6px 8px", color: "#e0e0e0",
  fontSize: 12, resize: "vertical", boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  background: "#3a5ab8", border: "none", color: "#fff",
  borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 12,
};

const btnSecondary: React.CSSProperties = {
  background: "#2a3044", border: "none", color: "#aaa",
  borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 12,
};
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

오류 없으면 성공.

- [ ] **Step 3: 개발 서버에서 UI 확인**

```bash
npm run dev
```

`http://localhost:3000` → 오피스 화면 오른쪽에 사이드패널 표시 확인.
`+ 에이전트 추가` 버튼 → 모달 열림 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/AgentPanel.tsx src/components/GameWrapper.tsx
git commit -m "feat: add AgentPanel sidebar and AgentCreateModal UI"
```

---

## Task 12: .env.local + docker-compose.yml 업데이트

**Files:**
- Modify: `.env.local`
- Modify: `docker-compose.yml`

- [ ] **Step 1: `.env.local`에 `OPENCLAW_WORKSPACE_ROOT` 추가**

`.env.local`에 추가:

```
OPENCLAW_WORKSPACE_ROOT=~/.openclaw/workspaces
```

- [ ] **Step 2: `docker-compose.yml`에 uploads 볼륨 추가**

`docker-compose.yml`을 다음으로 교체:

```yaml
services:
  clawoffice:
    image: ghcr.io/sck1993/bizdevoffice:latest
    restart: unless-stopped
    ports:
      - "${CLAWOFFICE_PORT:-3001}:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      OPENCLAW_URL: ${OPENCLAW_URL:-ws://openclaw:61744}
      OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_GATEWAY_TOKEN:-}
      OPENCLAW_WORKSPACE_ROOT: ${OPENCLAW_WORKSPACE_ROOT:-~/.openclaw/workspaces}
    volumes:
      - clawoffice_device:/app/data
      - clawoffice_uploads:/app/public/uploads
    networks:
      - openclaw_external

volumes:
  clawoffice_device:
  clawoffice_uploads:

networks:
  openclaw_external:
    external: true
    name: ${OPENCLAW_DOCKER_NETWORK:-openclaw-9cv4_default}
```

- [ ] **Step 3: 커밋**

```bash
git add .env.local docker-compose.yml
git commit -m "chore: add OPENCLAW_WORKSPACE_ROOT env, add uploads volume to docker-compose"
```

---

## Task 13: E2E 통합 검증

- [ ] **Step 1: 전체 빌드 확인**

```bash
npm run build
```

오류 없이 완료되면 성공.

- [ ] **Step 2: 개발 서버에서 에이전트 생성 E2E 테스트**

1. `npm run dev` 실행
2. `http://localhost:3000` 접속
3. 오른쪽 패널에서 `+ 에이전트 추가` 클릭
4. 이름: `Alice`, 역할: `프론트엔드 개발자`, 성격: `조용하고 꼼꼼함` 입력
5. [생성] 클릭
6. 확인 사항:
   - 패널 목록에 Alice 추가됨
   - 오피스 씬에 새 캐릭터 스폰됨
   - `data/agents.json` 파일 생성 확인

```bash
cat data/agents.json
```

- [ ] **Step 3: 에이전트 삭제 확인**

패널에서 Alice의 ✕ 버튼 클릭 → 패널에서 제거 + 오피스 씬에서 스프라이트 사라짐 확인.

- [ ] **Step 4: 서버 재시작 후 복원 확인**

```bash
# 서버 재시작
npm run dev
```

오피스 접속 → 이전에 생성한 에이전트가 다시 표시되는지 확인.

- [ ] **Step 5: 최종 커밋 + push**

```bash
git push origin main
```

GitHub Actions 빌드 확인: https://github.com/sck1993/bizdevoffice/actions
