# ClawOffice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenClaw 하위 에이전트들의 실시간 상태를 2D SD 캐릭터로 시각화하는 모니터링 웹앱 MVP를 구축한다.

**Architecture:** Next.js 커스텀 서버에 Socket.io를 통합하고, openclaw-gateway.js로 OpenClaw WebSocket RPC에 상시 연결하여 에이전트 상태 변화를 실시간으로 수신한다. Phaser3가 캐릭터 렌더링과 tween 이동을 담당하고, React EventBus로 Socket.io 이벤트를 Phaser3 씬에 전달한다.

**Tech Stack:** Next.js 15 (App Router), React 19, Phaser 3, Socket.io 4.x, TypeScript, Docker Compose

**Spec:** `docs/superpowers/specs/2026-04-05-clawoffice-design.md`

---

## 파일 구조 맵

| 파일 | 책임 |
|------|------|
| `server.js` | Next.js + Socket.io 통합 커스텀 서버 진입점 |
| `src/server/openclaw-gateway.js` | OpenClaw WebSocket RPC 클라이언트. 에이전트 이벤트 수신 및 상태 추론. [deskrpg 참고](https://github.com/dandacompany/deskrpg/blob/main/src/lib/openclaw-gateway.js) |
| `src/server/agent-state-store.ts` | 서버 메모리 Map. agentId → AgentState 관리 |
| `src/server/socket-handlers.ts` | Socket.io 이벤트 핸들러. 클라이언트 연결/스냅샷/상태변경 브로드캐스트 |
| `src/game/EventBus.ts` | Phaser3 ↔ React 이벤트 브릿지 (SimpleEventEmitter) |
| `src/game/config.ts` | 에이전트 데스크 위치, 미팅 좌석, 라운지 좌석 정적 config |
| `src/game/scenes/OfficeScene.ts` | Phaser3 메인 씬. 배경 로드, AgentSprite 생성/관리, EventBus 구독 |
| `src/game/sprites/AgentSprite.ts` | 에이전트 캐릭터 클래스. 상태별 애니메이션, tween 이동, 툴팁 |
| `src/app/page.tsx` | 게임 페이지. Phaser 게임 마운트 + React UI 오버레이 |
| `src/components/GameWrapper.tsx` | Phaser 게임 인스턴스 생성 및 Socket.io 클라이언트 연결 관리 |
| `src/components/DisconnectBanner.tsx` | Socket.io 연결 끊김 시 배너 표시 |
| `Dockerfile` | Next.js standalone 빌드 Docker 이미지 |
| `docker-compose.yml` | openclaw + clawoffice 서비스 정의 |

---

## Task 1: 프로젝트 초기화

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx` (스켈레톤)

- [ ] **Step 1: Next.js 프로젝트 생성**

```bash
cd C:/Users/gunho/Desktop/dev/clawoffice
npx create-next-app@latest . --typescript --app --no-src-dir --no-tailwind --import-alias "@/*"
```

`src` 디렉토리 사용 여부 묻는 항목: `Yes`
ESLint: `Yes`, Tailwind: `No`

- [ ] **Step 2: 의존성 설치**

```bash
npm install phaser socket.io socket.io-client
npm install -D @types/node cross-env
```

- [ ] **Step 3: next.config.ts — standalone 출력 설정**

`next.config.ts`를 다음으로 교체:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 4: 폴더 구조 생성**

```bash
mkdir -p src/server src/game/scenes src/game/sprites src/components public/assets/background public/assets/characters
```

- [ ] **Step 5: 개발 서버 실행 확인**

```bash
npm run dev
```

`http://localhost:3000` 접속 → Next.js 기본 페이지 표시되면 성공.

- [ ] **Step 6: 커밋**

```bash
git init
git add .
git commit -m "feat: initialize Next.js project with Phaser3 and Socket.io"
```

---

## Task 2: 커스텀 서버 (Next.js + Socket.io 통합)

**Files:**
- Create: `server.js`
- Create: `src/types/agent.ts` (공유 타입 정의)

Socket.io는 Next.js API Routes와 통합하기 어렵기 때문에 커스텀 Node.js 서버로 분리한다. [deskrpg의 server.js 패턴 참고](https://github.com/dandacompany/deskrpg/blob/main/server.js)

- [ ] **Step 1: 공유 타입 정의**

`src/types/agent.ts` 생성:

```ts
export type AgentStatus = "idle" | "working" | "meeting";

export interface AgentState {
  agentId: string;
  name: string;
  state: AgentStatus;   // 스펙 socket 이벤트 필드명 기준
  taskTitle?: string;
}

export interface AgentsSnapshot {
  agents: AgentState[];
}

export interface AgentStateChanged {
  agentId: string;
  state: AgentStatus;   // 스펙 socket 이벤트 필드명 기준
  taskTitle?: string;
}
```

- [ ] **Step 2: server.js 작성**

프로젝트 루트에 `server.js` 생성:

```js
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { registerSocketHandlers } = require("./src/server/socket-handlers");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log(`[socket] client connected: ${socket.id}`);
    registerSocketHandlers(io, socket);
    socket.on("disconnect", () => {
      console.log(`[socket] client disconnected: ${socket.id}`);
    });
  });

  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
```

- [ ] **Step 3: package.json scripts 수정**

`package.json`의 `scripts`를 다음으로 업데이트:

```json
"scripts": {
  "dev": "node server.js",
  "build": "next build",
  "start": "cross-env NODE_ENV=production node server.js"
}
```

- [ ] **Step 4: socket-handlers.ts 스텁 생성**

`src/server/socket-handlers.ts` 생성 (아직 빈 껍데기):

```ts
import { Server, Socket } from "socket.io";

export function registerSocketHandlers(io: Server, socket: Socket) {
  // Task 4에서 구현
}
```

- [ ] **Step 5: 서버 실행 확인**

```bash
npm run dev
```

`http://localhost:3000` → 정상 표시되면 성공.

- [ ] **Step 6: 커밋**

```bash
git add server.js src/types/agent.ts src/server/socket-handlers.ts package.json
git commit -m "feat: add custom server with Socket.io integration"
```

---

## Task 3: 에이전트 상태 저장소 + OpenClaw Gateway

> **⚠️ 모듈 전략:** `server.js`가 CommonJS라 `require()`로 `.ts` 파일을 직접 로드할 수 없다.
> `src/server/` 하위 파일은 전부 `.js`(CommonJS)로 작성한다.
> TypeScript 타입은 `src/types/agent.ts`에서 클라이언트(Phaser/React) 전용으로만 사용한다.

**Files:**
- Create: `src/server/agent-state-store.js`
- Create: `src/server/openclaw-gateway.js`
- Create: `src/server/gateway-manager.js`

- [ ] **Step 1: agent-state-store.js 작성**

`src/server/agent-state-store.js` 생성:

```js
/** @typedef {"idle"|"working"|"meeting"} AgentStatus */
/** @typedef {{ agentId: string, name: string, state: AgentStatus, taskTitle?: string }} AgentState */

class AgentStateStore {
  constructor() {
    /** @type {Map<string, AgentState>} */
    this.states = new Map();
  }

  set(agentId, data) {
    const existing = this.states.get(agentId) ?? {};
    this.states.set(agentId, { ...existing, ...data });
  }

  updateStatus(agentId, state, taskTitle) {
    const existing = this.states.get(agentId);
    if (!existing) return false;
    this.states.set(agentId, { ...existing, state, taskTitle });
    return true;
  }

  getAll() {
    return Array.from(this.states.values());
  }

  get(agentId) {
    return this.states.get(agentId);
  }

  resetAll() {
    for (const [id, agentState] of this.states) {
      this.states.set(id, { ...agentState, state: "idle", taskTitle: undefined });
    }
  }
}

module.exports = { agentStateStore: new AgentStateStore() };
```

- [ ] **Step 2: openclaw-gateway.js 작성**

`src/server/openclaw-gateway.js` 생성.

deskrpg의 `src/lib/openclaw-gateway.js`를 기반으로, 에이전트 상태 변화를 감지하는 콜백을 추가한다. 핵심 구조:

```js
const WebSocket = require("ws");
const EventEmitter = require("events");

class OpenClawGateway extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.reconnectDelay = 5000;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      console.log("[gateway] connected to OpenClaw");
      this.emit("connected");
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleMessage(msg);
      } catch (e) {
        // non-JSON 메시지 무시
      }
    });

    this.ws.on("close", () => {
      console.log("[gateway] disconnected — retrying in", this.reconnectDelay, "ms");
      this.emit("disconnected");
      setTimeout(() => this.connect(), this.reconnectDelay);
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
    if (this.ws) this.ws.close();
  }
}

module.exports = { OpenClawGateway };
```

> **주의:** `_handleMessage` 내부의 실제 파싱 로직은 OpenClaw WebSocket 연결 후 실제 메시지 포맷 확인이 필요하다. deskrpg의 `chatStream` 파싱 로직을 참고할 것.

- [ ] **Step 3: gateway-manager.js 작성**

`src/server/gateway-manager.js` 생성 — gateway와 state store를 연결:

```js
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
```

- [ ] **Step 4: server.js에서 gateway 초기화**

`server.js`의 `io.on("connection", ...)` 앞에 추가:

```js
const { initGateway } = require("./src/server/gateway-manager");
// ...
// httpServer.listen(...) 직전:
initGateway(io);
```

- [ ] **Step 5: .env.local 작성**

```bash
echo "OPENCLAW_URL=ws://localhost:3000" > .env.local
```

실제 VPS 배포 시에는 `ws://openclaw:3000`으로 변경.

- [ ] **Step 6: 커밋**

```bash
git add src/server/ .env.local
git commit -m "feat: add agent state store and OpenClaw gateway manager"
```

---

## Task 4: Socket.io 핸들러 구현

**Files:**
- Modify: `src/server/socket-handlers.js` (세션 1에서 .js로 생성됨)
- Modify: `server.js`

- [ ] **Step 1: socket-handlers.js 구현**

`src/server/socket-handlers.js`를 다음으로 교체:

```js
const { agentStateStore } = require("./agent-state-store");

function registerSocketHandlers(io, socket) {
  // 접속 시 전체 스냅샷 전송
  socket.emit("agents:snapshot", {
    agents: agentStateStore.getAll(),
  });
}

module.exports = { registerSocketHandlers };
```

- [ ] **Step 2: server.js에서 gateway 초기화 추가**

`server.js` 상단 require 블록에 추가:

```js
const { initGateway } = require("./src/server/gateway-manager");
```

`httpServer.listen(...)` 호출 직전에 추가:

```js
initGateway(io);
```

- [ ] **Step 3: Socket.io 클라이언트로 연결 테스트**

별도 터미널에서:

```bash
node -e "
const { io } = require('socket.io-client');
const s = io('http://localhost:3000');
s.on('agents:snapshot', (d) => { console.log('snapshot:', JSON.stringify(d, null, 2)); process.exit(0); });
"
```

Expected: `agents:snapshot` 이벤트에 5개 에이전트 상태 출력.

- [ ] **Step 4: 커밋**

```bash
git add src/server/socket-handlers.js src/server/gateway-manager.js src/server/agent-state-store.js server.js .env.local
git commit -m "feat: implement socket handlers with agent snapshot on connect"
```

---

## Task 5: Phaser3 EventBus & 게임 Config

**Files:**
- Create: `src/game/EventBus.ts`
- Create: `src/game/config.ts`

- [ ] **Step 1: EventBus.ts 작성**

`src/game/EventBus.ts` 생성:

```ts
type Handler = (...args: unknown[]) => void;

class SimpleEventEmitter {
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((h) => h(...args));
  }
}

export const EventBus = new SimpleEventEmitter();
```

- [ ] **Step 2: config.ts 작성**

`src/game/config.ts` 생성.

좌표는 배경 이미지 해상도(1280×640 기준) 기준. 배경 이미지 완성 후 조정 가능.

```ts
// 게임 캔버스 기준 해상도
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 640;

// Row 1 / Row 2 경계 Y 좌표
export const ROW_BOUNDARY_Y = GAME_HEIGHT * 0.52; // 333px

// 에이전트별 데스크 위치 (agentId → {x, y})
// agentId는 실제 OpenClaw 에이전트 ID로 교체 필요
export const DESK_POSITIONS: Record<string, { x: number; y: number }> = {
  "agent-a": { x: 160, y: 210 },
  "agent-b": { x: 320, y: 210 },
  "agent-c": { x: 160, y: 295 },
  "agent-d": { x: 320, y: 295 },
  // agent-e: 데스크 없음 → idle/working 시 라운지 유지
};

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

- [ ] **Step 3: 커밋**

```bash
git add src/game/EventBus.ts src/game/config.ts
git commit -m "feat: add game EventBus and position config"
```

---

## Task 6: AgentSprite 클래스

**Files:**
- Create: `src/game/sprites/AgentSprite.ts`

Phaser3의 `Phaser.GameObjects.Sprite`를 상속하여 상태 관리, tween 이동, 애니메이션 재생, 툴팁을 담당한다.

- [ ] **Step 1: AgentSprite.ts 작성**

`src/game/sprites/AgentSprite.ts` 생성:

```ts
import Phaser from "phaser";
import { AgentStatus } from "../../types/agent";
import { DESK_POSITIONS, LOUNGE_SEATS, MEETING_SEATS } from "../config";

interface AgentSpriteConfig {
  scene: Phaser.Scene;
  agentId: string;
  name: string;
  initialStatus: AgentStatus;
  loungeIndex: number; // 라운지 좌석 인덱스
}

export class AgentSprite extends Phaser.GameObjects.Sprite {
  agentId: string;
  agentName: string;
  currentStatus: AgentStatus;
  private loungeIndex: number;
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

    config.scene.add.existing(this);
    this.setInteractive();

    // 이름 라벨
    this.label = config.scene.add.text(this.x, this.y - 50, config.name, {
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#00000088",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5);

    // 툴팁 (기본 숨김)
    this.tooltip = config.scene.add.text(this.x, this.y - 70, "", {
      fontSize: "11px",
      color: "#ffffcc",
      backgroundColor: "#333333cc",
      padding: { x: 6, y: 3 },
      wordWrap: { width: 200 },
    }).setOrigin(0.5).setVisible(false);

    this.on("pointerdown", () => this.showTooltip());
    config.scene.input.on("pointerdown", (_: unknown, gameObjects: Phaser.GameObjects.GameObject[]) => {
      if (!gameObjects.includes(this)) this.hideTooltip();
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
      case "working": {
        const desk = DESK_POSITIONS[this.agentId];
        return desk ?? LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
      }
      case "meeting": {
        return MEETING_SEATS[this.meetingSeatIndex] ?? LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
      }
      default:
        return LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
    }
  }

  // Phaser 기본 클래스 setState(value)와 시그니처 충돌 → setAgentState로 명명
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
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/game/sprites/AgentSprite.ts
git commit -m "feat: add AgentSprite class with tween movement and state management"
```

---

## Task 7: OfficeScene 구현

**Files:**
- Create: `src/game/scenes/OfficeScene.ts`

- [ ] **Step 1: OfficeScene.ts 작성**

`src/game/scenes/OfficeScene.ts` 생성:

```ts
import Phaser from "phaser";
import { AgentSprite } from "../sprites/AgentSprite";
import { EventBus } from "../EventBus";
import { GAME_WIDTH, GAME_HEIGHT, MEETING_SEATS } from "../config";
import { AgentState, AgentStateChanged, AgentsSnapshot } from "../../types/agent";

export class OfficeScene extends Phaser.Scene {
  private agents = new Map<string, AgentSprite>();
  private meetingOccupied: (string | null)[] = MEETING_SEATS.map(() => null);

  constructor() {
    super({ key: "OfficeScene" });
  }

  preload() {
    // 배경 이미지 (public/assets/background/office.png)
    this.load.image("background", "/assets/background/office.png");

    // 캐릭터 스프라이트시트
    // frameWidth, frameHeight는 실제 에셋에 맞게 조정 필요
    this.load.spritesheet("character", "/assets/characters/agent.png", {
      frameWidth: 96,
      frameHeight: 96,
    });
  }

  create() {
    // 배경
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "background")
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    // 애니메이션 등록
    // 실제 프레임 번호는 스프라이트시트 구성에 맞게 조정 필요
    this.anims.create({ key: "agent_idle",    frames: this.anims.generateFrameNumbers("character", { start: 0, end: 3 }),  frameRate: 6, repeat: -1 });
    this.anims.create({ key: "agent_working", frames: this.anims.generateFrameNumbers("character", { start: 4, end: 7 }),  frameRate: 8, repeat: -1 });
    this.anims.create({ key: "agent_meeting", frames: this.anims.generateFrameNumbers("character", { start: 8, end: 11 }), frameRate: 6, repeat: -1 });

    // EventBus 구독
    EventBus.on("agents:snapshot", (data: unknown) => {
      const { agents } = data as AgentsSnapshot;
      agents.forEach((a, i) => this.spawnAgent(a, i));
    });

    EventBus.on("agent:state-changed", (data: unknown) => {
      const { agentId, state: status, taskTitle } = data as AgentStateChanged;
      const sprite = this.agents.get(agentId);
      if (!sprite) return;

      let meetingSeatIndex = -1;
      if (status === "meeting") {
        meetingSeatIndex = this.claimMeetingSeat(agentId);
      } else {
        this.releaseMeetingSeat(agentId);
      }

      sprite.setAgentState(status, { taskTitle, meetingSeatIndex });
    });

    EventBus.on("connection:lost", () => {
      this.agents.forEach((sprite) => sprite.dim(true));
    });

    EventBus.on("connection:restored", () => {
      this.agents.forEach((sprite) => sprite.dim(false));
    });
  }

  private spawnAgent(state: AgentState, index: number) {
    if (this.agents.has(state.agentId)) return;
    const sprite = new AgentSprite({
      scene: this,
      agentId: state.agentId,
      name: state.name,
      initialStatus: state.status,
      loungeIndex: index % 5,
    });
    this.agents.set(state.agentId, sprite);
  }

  private claimMeetingSeat(agentId: string): number {
    // 이미 자리 있으면 재사용
    const existing = this.meetingOccupied.indexOf(agentId);
    if (existing !== -1) return existing;
    // 빈 자리 배정
    const empty = this.meetingOccupied.indexOf(null);
    if (empty !== -1) {
      this.meetingOccupied[empty] = agentId;
      return empty;
    }
    return -1; // 5개 초과 시 라운지 유지
  }

  private releaseMeetingSeat(agentId: string) {
    const idx = this.meetingOccupied.indexOf(agentId);
    if (idx !== -1) this.meetingOccupied[idx] = null;
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/game/scenes/OfficeScene.ts
git commit -m "feat: implement OfficeScene with agent spawning and state transitions"
```

---

## Task 8: React UI — GameWrapper & 연결 관리

**Files:**
- Create: `src/components/GameWrapper.tsx`
- Create: `src/components/DisconnectBanner.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: DisconnectBanner.tsx 작성**

`src/components/DisconnectBanner.tsx` 생성:

```tsx
export function DisconnectBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0,
      background: "#c0392b", color: "#fff",
      textAlign: "center", padding: "8px",
      fontFamily: "monospace", fontSize: "14px",
      zIndex: 1000,
    }}>
      ⚠️ 서버 연결이 끊어졌습니다. 재연결 중...
    </div>
  );
}
```

- [ ] **Step 2: GameWrapper.tsx 작성**

`src/components/GameWrapper.tsx` 생성:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { EventBus } from "../game/EventBus";
import { DisconnectBanner } from "./DisconnectBanner";

export function GameWrapper() {
  const gameRef = useRef<HTMLDivElement>(null);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    // Phaser는 클라이언트 전용 — dynamic import
    let game: import("phaser").Game;

    const initPhaser = async () => {
      const Phaser = (await import("phaser")).default;
      const { OfficeScene } = await import("../game/scenes/OfficeScene");
      const { GAME_WIDTH, GAME_HEIGHT } = await import("../game/config");

      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent: gameRef.current!,
        backgroundColor: "#d4c5a0",
        scene: [OfficeScene],
      });
    };

    const socket: Socket = io();

    socket.on("connect", () => {
      setDisconnected(false);
      EventBus.emit("connection:restored");
    });

    socket.on("disconnect", () => {
      setDisconnected(true);
      EventBus.emit("connection:lost");
    });

    socket.on("agents:snapshot", (data) => {
      EventBus.emit("agents:snapshot", data);
    });

    socket.on("agent:state-changed", (data) => {
      EventBus.emit("agent:state-changed", data);
    });

    initPhaser();

    return () => {
      socket.disconnect();
      game?.destroy(true);
    };
  }, []);

  return (
    <>
      <DisconnectBanner visible={disconnected} />
      <div ref={gameRef} style={{ width: "100%", maxWidth: 1280, margin: "0 auto" }} />
    </>
  );
}
```

- [ ] **Step 3: page.tsx 작성**

`src/app/page.tsx`를 다음으로 교체:

```tsx
import { GameWrapper } from "../components/GameWrapper";

export default function HomePage() {
  return (
    <main style={{ background: "#1a1a2e", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <GameWrapper />
    </main>
  );
}
```

- [ ] **Step 4: layout.tsx 글로벌 스타일 정리**

`src/app/layout.tsx`:

```tsx
export const metadata = { title: "ClawOffice" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: 플레이스홀더 에셋 생성**

배경 이미지와 스프라이트시트가 없으면 Phaser가 에러를 낸다. Node.js로 최소 PNG를 생성한다:

```bash
node -e "
const fs = require('fs');
// 최소 유효 1x1 투명 PNG (base64)
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync('public/assets/background/office.png', png1x1);
fs.writeFileSync('public/assets/characters/agent.png', png1x1);
console.log('placeholder assets created');
"
```

> 실제 에셋은 Task 10에서 교체한다. 이 플레이스홀더로 Phaser 씬이 에러 없이 로드되는지 확인 가능하다.

- [ ] **Step 6: 통합 확인**

```bash
npm run dev
```

`http://localhost:3000` → Phaser 캔버스 표시, 브라우저 콘솔에 Socket.io 연결 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/components/ src/app/
git commit -m "feat: add GameWrapper with Socket.io client and Phaser3 integration"
```

---

## Task 9: Docker 배포 설정

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: .dockerignore 작성**

```
node_modules
.next
.git
.env.local
docs
```

- [ ] **Step 2: Dockerfile 작성**

```dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: docker-compose.yml 작성**

프로젝트 루트(clawoffice 디렉토리 상위)에 작성:

```yaml
version: "3.8"
services:
  openclaw:
    image: openclaw/openclaw:latest
    restart: unless-stopped
    # 포트 외부 미노출 — 내부 네트워크로만 접근

  clawoffice:
    build:
      context: ./clawoffice
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      - OPENCLAW_URL=ws://openclaw:3000
      - NODE_ENV=production
    depends_on:
      - openclaw
```

- [ ] **Step 4: Docker 빌드 확인**

```bash
npm run build
docker build -t clawoffice .
docker run -p 3001:3000 -e OPENCLAW_URL=ws://host.docker.internal:3000 clawoffice
```

`http://localhost:3001` 접속 확인.

- [ ] **Step 5: 커밋**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: add Docker and docker-compose deployment configuration"
```

---

## Task 10: 실제 에셋 연결 & 좌표 조정

**Files:**
- Modify: `src/game/config.ts`
- Modify: `src/game/scenes/OfficeScene.ts`
- Add: `public/assets/background/office.png`
- Add: `public/assets/characters/agent.png`

배경 이미지와 SD 스프라이트시트가 준비되면 진행한다.

- [ ] **Step 1: 에셋 배치**

```bash
# 완성된 배경 이미지
cp /path/to/office.png public/assets/background/office.png

# SD 캐릭터 스프라이트시트
cp /path/to/agent.png public/assets/characters/agent.png
```

- [ ] **Step 2: OfficeScene 프레임 설정 업데이트**

`OfficeScene.ts`의 `this.load.spritesheet` 및 `this.anims.create` 블록에서 실제 스프라이트시트의 `frameWidth`, `frameHeight`, 프레임 번호를 확인하여 수정.

- [ ] **Step 3: config.ts 좌표 조정**

`src/game/config.ts`의 `DESK_POSITIONS`, `MEETING_SEATS`, `LOUNGE_SEATS` 좌표를 실제 배경 이미지 기준으로 조정.

- [ ] **Step 4: 실제 OpenClaw agentId 반영**

실제 OpenClaw 에이전트 ID를 확인하여 `DESK_POSITIONS` 키와 `gateway-manager.ts`의 더미 데이터를 교체.

- [ ] **Step 5: 최종 동작 확인 & 커밋**

```bash
npm run dev
# 브라우저에서 캐릭터가 배경 위에 올바른 위치에 표시되는지 확인
git add public/assets/ src/game/config.ts src/game/scenes/OfficeScene.ts src/server/gateway-manager.ts
git commit -m "feat: connect real assets and OpenClaw agent IDs"
```

---

## 세션 분할 가이드

작업을 여러 세션으로 나눌 때 권장 묶음:

| 세션 | Tasks | 완료 시 동작하는 것 |
|------|-------|-------------------|
| 1 | Task 1–2 | Next.js + 커스텀 서버 실행 |
| 2 | Task 3–4 | 에이전트 상태 관리 + Socket.io 스냅샷 |
| 3 | Task 5–6 | Phaser3 EventBus + AgentSprite 클래스 |
| 4 | Task 7–8 | 게임 씬 완성 + React UI 통합 → 브라우저에서 캐릭터 보임 |
| 5 | Task 9   | Docker 배포 |
| 6 | Task 10  | 실제 에셋 + OpenClaw 연결 완성 |

---

## 참고 자료

- [deskrpg GitHub](https://github.com/dandacompany/deskrpg) — openclaw-gateway.js, socket-handlers 패턴
- [Phaser3 Docs — Tweens](https://newdocs.phaser.io/docs/3.60.0/Phaser.Tweens.TweenManager)
- [Phaser3 Docs — Spritesheets](https://newdocs.phaser.io/docs/3.60.0/Phaser.Loader.LoaderPlugin#spritesheet)
- [OpenClaw Sub-Agents](https://docs.openclaw.ai/tools/subagents)
