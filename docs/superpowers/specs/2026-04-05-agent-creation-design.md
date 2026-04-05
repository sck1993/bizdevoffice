# Agent Creation & Customization — Design Spec

**Date:** 2026-04-05
**Project:** ClawOffice
**Reference:** [deskrpg](https://github.com/dandacompany/deskrpg)

---

## Goal

사용자가 bizdevoffice UI에서 직접 에이전트 NPC를 생성·관리할 수 있게 한다. 이름, 역할(identity), 성격(soul), 프로필 사진을 입력하면 OpenClaw에 실제 에이전트가 만들어지고 오피스 씬에 캐릭터로 등장한다.

---

## Architecture

```
[AgentPanel UI]
  이름 + identity + soul + 프로필 사진 입력
       ↓  POST /api/agents
[API Route]
  1. in-process 뮤텍스 획득
  2. agentId 생성 + 중복 확인
  3. 빈 데스크 슬롯 확인
  4. OpenClaw RPC: agents.create(name, workspace)
     └─ 실패 시 → 뮤텍스 해제 후 503 반환
  5. OpenClaw RPC: agents.files.set(agentId, "IDENTITY.md", identity)
     └─ 실패 시 → agents.delete(agentId) 호출 후 뮤텍스 해제 후 502 반환
  6. OpenClaw RPC: agents.files.set(agentId, "SOUL.md", soul)
     └─ 실패 시 → agents.delete(agentId) 호출 후 뮤텍스 해제 후 502 반환
  7. data/agents.json 저장 (temp → rename 패턴)
  8. 뮤텍스 해제
  9. agentStateStore.set(agentId, { agentId, name, state: "idle", deskIndex })
  10. Socket.io broadcast: agents:snapshot
       ↓
[OfficeScene]
  새 AgentSprite 스폰 → DESK_SLOTS[deskIndex] 좌표로 배치
```

---

## Data Model

### `data/agents.json`

```json
[
  {
    "agentId": "alice",
    "name": "Alice",
    "identity": "당신은 프론트엔드 개발자입니다...",
    "soul": "완벽주의적이고 조용하지만 필요할 때 직설적입니다...",
    "profileImage": "/uploads/550e8400-e29b-41d4-a716-446655440000.png",
    "deskIndex": 0,
    "createdAt": "2026-04-05T00:00:00.000Z"
  }
]
```

**필드 설명:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `agentId` | string | 이름을 소문자+하이픈으로 변환한 slug. ASCII 안전 처리 필요 |
| `name` | string | 표시 이름 |
| `identity` | string | IDENTITY.md로 OpenClaw에 주입되는 역할 지침 |
| `soul` | string | SOUL.md로 OpenClaw에 주입되는 성격 지침 |
| `profileImage` | string \| null | `/uploads/{uuid}.{ext}` 경로. 없으면 null |
| `deskIndex` | number | 데스크 슬롯 index (0~3). 슬롯 없으면 -1 |
| `createdAt` | string | ISO 8601 생성 시각 |

### AgentConfig 타입 (`src/types/agent.ts`에 추가)

```ts
export interface AgentConfig {
  agentId: string;
  name: string;
  identity: string;
  soul: string;
  profileImage: string | null;
  deskIndex: number;
  createdAt: string;
}
```

### AgentState 타입 변경 (`src/types/agent.ts`)

`deskIndex`를 포함하도록 확장:

```ts
export interface AgentState {
  agentId: string;
  name: string;
  state: AgentStatus;
  taskTitle?: string;
  deskIndex?: number; // 추가 — 스냅샷으로 OfficeScene에 전달
}
```

### 데스크 슬롯

`config.ts`의 `DESK_POSITIONS`(keyed by agentId)를 제거하고 `DESK_SLOTS`(index 배열)로 교체:

```ts
export const DESK_SLOTS: { x: number; y: number }[] = [
  { x: 160, y: 210 },
  { x: 320, y: 210 },
  { x: 160, y: 295 },
  { x: 320, y: 295 },
];
```

에이전트 생성 시 `agents.json`에서 `deskIndex`가 사용 중이지 않은 슬롯 중 가장 낮은 index 배정. 삭제 시 슬롯 반환.

---

## OpenClaw Gateway 변경

`openclaw-gateway.js`에 RPC 송신 지원 추가.

### `_pending` Map 및 `_rpcRequest`

```js
constructor(url) {
  // 기존 필드 유지 +
  this._pending = new Map(); // id → { resolve, reject, timer }
  this._rpcTimeout = 30000;
}

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

isConnected() {
  return this.ws?.readyState === WebSocket.OPEN;
}
```

### `_handleMessage` 에 res 처리 추가

```js
// 기존 _connectRequestId 처리 이후:
if (msg?.type === "res" && this._pending.has(msg.id)) {
  const { resolve, reject, timer } = this._pending.get(msg.id);
  this._pending.delete(msg.id);
  clearTimeout(timer);
  if (msg.ok) resolve(msg.payload ?? msg);
  else reject(new Error(JSON.stringify(msg.error ?? msg)));
  return;
}
```

### 추가 메서드

```js
// agentsCreate: OpenClaw는 name 필드를 agentId로 사용한다 (deskrpg 참고)
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

### workspace 값

`agentsCreate` 호출 시 workspace는 `process.env.OPENCLAW_WORKSPACE_ROOT`를 사용.
`.env.local` 기본값:
```
OPENCLAW_WORKSPACE_ROOT=~/.openclaw/workspaces
```
최종 workspace 값: `${OPENCLAW_WORKSPACE_ROOT}/${agentId}`

### `gateway-manager.js` 변경

gateway 및 io 인스턴스를 API 라우트에서 접근할 수 있도록 `global` 싱글턴으로 노출.
Next.js dev hot-reload 시 모듈 캐시가 무효화될 수 있으므로 global에 저장.

`server.js`에서 `io` 생성 직후:
```js
global.__clawIo = io;
```

`gateway-manager.js`:
```js
// global 싱글턴
if (!global.__clawGateway) {
  global.__clawGateway = new OpenClawGateway(process.env.OPENCLAW_URL);
}
const gateway = global.__clawGateway;

module.exports = { initGateway, gateway };
```

API 라우트에서:
```js
const { gateway } = require("../../../server/gateway-manager");
const io = global.__clawIo; // Socket.io 브로드캐스트용
```

---

## 동시성: in-process 뮤텍스

에이전트 생성/삭제 시 `agents.json` read-modify-write를 직렬화하기 위해 간단한 Promise 체인 뮤텍스 사용.
외부 패키지 불필요.

```js
// src/server/agent-file-store.js 내부
let _writeLock = Promise.resolve();

function withLock(fn) {
  const next = _writeLock.then(() => fn());
  _writeLock = next.catch(() => {});
  return next;
}
```

`POST /api/agents`와 `DELETE /api/agents/[id]`는 모두 `withLock` 내에서 읽기/쓰기/RPC를 실행.

**알려진 트레이드오프:** RPC 호출(최대 30초 타임아웃 x3)이 뮤텍스 안에 포함되므로, 에이전트 동시 생성 요청은 직렬화된다. 3~4명 규모에서는 실질적 문제 없음.

### agents.json atomic write

```js
function saveAll(agents) {
  const tmp = AGENTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(agents, null, 2), "utf8");
  fs.renameSync(tmp, AGENTS_FILE); // atomic on same filesystem
}
```

---

## API Endpoints

모두 Next.js App Router (`src/app/api/`) 기반.
API 라우트는 `require("../../../server/gateway-manager").gateway`로 gateway 싱글턴에 접근.

### `GET /api/agents`

`data/agents.json` 읽어서 목록 반환.

```ts
// Response 200
{ agents: AgentConfig[] }
```

### `POST /api/agents`

에이전트 생성. `withLock` 내에서 실행.

```ts
// Request body
{
  name: string;         // 필수
  identity: string;     // 필수
  soul: string;         // 필수
  profileImage?: string; // /uploads/{uuid}.{ext} (선업로드 후 전달). 없으면 null
}

// Response 201
{ agent: AgentConfig }

// Error cases
// 400: 필수 필드 누락 (name/identity/soul 없음)
// 503: OpenClaw 미연결
// 502: RPC 실패 (IDENTITY.md 또는 SOUL.md set 실패, rollback 완료)
// 504: RPC 타임아웃
//   - agentsCreate 타임아웃: OpenClaw 생성 여부 불확실 → rollback 시도 후 504
//   - IDENTITY/SOUL set 타임아웃: agentsDelete rollback 후 504
// ※ 중복 agentId는 auto-suffix로 자동 해소 — 409 없음
```

**agentId 생성:**
```js
function toAgentId(name, existingIds) {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")  // ASCII 이외 제거
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "agent";

  // 중복이면 자동으로 -2, -3 ... suffix 추가 (409 반환하지 않음)
  let candidate = slug;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${slug}-${counter++}`;
  }
  return candidate;
}
```

CJK 이름 등 ASCII 변환이 안 되면 `"agent"` fallback 후 숫자 suffix.
409는 반환하지 않으며, 항상 auto-suffix로 충돌을 자동 해소한다.

**처리 순서 (withLock 내):**
1. agentId 생성 (auto-suffix 포함)
2. 빈 데스크 슬롯 배정 (없으면 deskIndex = -1)
3. `gateway.agentsCreate(agentId, workspace)` — 실패 시 503/502/504 반환
4. `gateway.agentsFileSet(agentId, "IDENTITY.md", identity)` — 실패 시 `agentsDelete` 후 502 반환
5. `gateway.agentsFileSet(agentId, "SOUL.md", soul)` — 실패 시 `agentsDelete` 후 502 반환
6. `saveAll([...existing, newAgent])` (temp→rename)
7. withLock 종료
8. `agentStateStore.set(agentId, { agentId, name, state: "idle", deskIndex })`
9. `io.emit("agents:snapshot", { agents: agentStateStore.getAll() })`
10. 201 반환

### `DELETE /api/agents/[id]`

에이전트 삭제. `withLock` 내에서 실행.

**처리 순서:**
1. `agents.json`에서 대상 확인 (없으면 404)
2. `gateway.agentsDelete(agentId)` — RPC 실패는 로그만, 로컬은 계속 삭제
3. `saveAll(existing.filter(...))`
4. `agentStateStore.delete(agentId)`
5. 해당 에이전트의 `profileImage` 파일이 있으면 `fs.unlink`로 삭제 (실패는 로그만)
6. `io.emit("agent:removed", { agentId })` ← 전용 이벤트 (OfficeScene 스프라이트 despawn용)
7. 204 반환

> `agents:snapshot` 대신 `agent:removed` 이벤트를 사용해 OfficeScene이 diff 없이 특정 스프라이트만 제거할 수 있게 한다.

### `POST /api/agents/upload`

프로필 이미지 업로드. 에이전트 생성 전에 먼저 호출.

**파싱 방법:** Next.js App Router Route Handler는 `request.formData()`를 네이티브 지원한다. 별도 라이브러리 불필요.

```ts
const formData = await request.formData();
const file = formData.get("file") as File;
const buffer = Buffer.from(await file.arrayBuffer());
fs.writeFileSync(destPath, buffer);
```

- 필드명: `file`
- 저장 경로: `public/uploads/{uuid}.{ext}` (agentId 불필요)
- `public/uploads/` 디렉토리는 `agent-file-store.js` 모듈 로드 시 `fs.mkdirSync(..., { recursive: true })`로 보장
- Response 200: `{ url: "/uploads/{uuid}.{ext}" }`
- Error 400: 파일 없음 / 타입 불허
- Error 413: 2MB 초과
- 허용 타입: image/jpeg, image/png, image/webp
- 최대 크기: 2MB
- 생성 취소 등으로 업로드만 되고 에이전트가 생성되지 않으면 파일이 남음 (孤兒 파일). 3~4명 규모에서는 무시 가능.

### `GET /api/gateway/status`

React 컴포넌트가 OpenClaw(서버→OpenClaw) 연결 상태를 확인하기 위한 엔드포인트.
Socket.io(브라우저→서버) 연결 상태와는 별개임.

```ts
// Response 200
{ connected: boolean }
```

`gateway.isConnected()` 결과 반환. `AgentPanel`에서 5초 간격 polling.

---

## 서버 재시작 시 복원

`gateway-manager.js`의 `initGateway()` 진입 시:

```js
const saved = agentFileStore.loadAll(); // data/agents.json 읽기 (손상 시 [] fallback)
for (const agent of saved) {
  agentStateStore.set(agent.agentId, {
    agentId: agent.agentId,
    name: agent.name,
    state: "idle",
    deskIndex: agent.deskIndex,
  });
}
```

health 이벤트로 들어오는 "main" 등 JSON에 없는 에이전트는 기존 로직 그대로 자동 등록 (`deskIndex`는 `undefined` — 라운지 배치).

`loadAll()` 구현:
```js
function loadAll() {
  try {
    if (!fs.existsSync(AGENTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(AGENTS_FILE, "utf8"));
  } catch {
    // 손상된 파일은 백업 후 빈 배열 반환
    try { fs.renameSync(AGENTS_FILE, AGENTS_FILE + ".bak"); } catch {}
    console.error("[agent-file-store] agents.json corrupted — reset to empty");
    return [];
  }
}
```

**`deskIndex` 통일:** 데스크 없음은 항상 `-1`로 표현. `undefined`는 사용하지 않음.
`AgentState.deskIndex?: number`에서 `-1`이 "no desk"를 의미한다.

---

## AgentSprite 변경

`deskPos`를 생성 시 주입받아 인스턴스 변수로 저장. 이후 `setAgentState("working")` 호출에서도 동일 좌표 사용.

```ts
interface AgentSpriteConfig {
  scene: Phaser.Scene;
  agentId: string;
  name: string;
  initialStatus: AgentStatus;
  loungeIndex: number;
  deskPos?: { x: number; y: number }; // 추가
}

class AgentSprite {
  private deskPos: { x: number; y: number } | undefined;

  constructor(config: AgentSpriteConfig) {
    this.deskPos = config.deskPos;
    // ...
  }

  getTargetPosition(state: AgentStatus): { x: number; y: number } {
    if (state === "working" && this.deskPos) return this.deskPos;
    // 기존 lounge / meeting 로직
  }
}
```

---

## OfficeScene 변경

### spawnAgent 변경

```ts
private spawnAgent(state: AgentState, index: number) {
  if (this.agents.has(state.agentId)) return;

  const deskPos = state.deskIndex != null && state.deskIndex >= 0
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
  // ... 기존 meetingSeat 로직
}
```

### agent:removed 이벤트 처리 추가

```ts
const handleAgentRemoved = ({ agentId }: { agentId: string }) => {
  const sprite = this.agents.get(agentId);
  if (!sprite) return;
  sprite.destroy();
  this.agents.delete(agentId);
};

EventBus.on("agent:removed", handleAgentRemoved);
// shutdown 시 off 추가
```

`GameWrapper.tsx`에서:
```ts
socket.on("agent:removed", (data) => {
  EventBus.emit("agent:removed", data);
});
```

---

## UI 구성

### AgentPanel (사이드패널)

오피스 화면 오른쪽에 상시 표시되는 React 컴포넌트.

```
┌──────────────────┐
│ Agents           │
│ ──────────────── │
│ 🖼 Alice          │
│    working...    │
│ 🖼 Bob            │
│    idle          │
│ ──────────────── │
│  [+ 에이전트 추가] │
└──────────────────┘
```

**데이터 merge 전략:**
`AgentConfig`(설정, profileImage 포함)와 `AgentState`(런타임 상태)를 클라이언트에서 병합.

```ts
// AgentPanel 내부 상태
const [configs, setConfigs] = useState<AgentConfig[]>([]);   // GET /api/agents
const [states, setStates] = useState<AgentState[]>([]);      // agents:snapshot

// merge: agentId 기준으로 join
const merged = configs.map(c => ({
  ...c,
  state: states.find(s => s.agentId === c.agentId)?.state ?? "idle",
  taskTitle: states.find(s => s.agentId === c.agentId)?.taskTitle,
}));
```

- 초기 로드: `GET /api/agents`로 configs, Socket.io `agents:snapshot`으로 states
- 실시간 상태 갱신: `agents:snapshot` → states 갱신
- 에이전트 추가: 201 응답 → configs에 append
- 에이전트 삭제: `agent:removed` 이벤트 → configs/states 양쪽에서 제거
- 프로필 사진: `config.profileImage`에서 읽어 `<img>` 렌더링. 없으면 기본 아이콘
- 상태 표시: idle / working (taskTitle) / meeting
- **OpenClaw 연결 상태:** `GET /api/gateway/status` 5초 polling (서버→OpenClaw 연결).
  Socket.io의 `connection:lost`/`connection:restored` 이벤트는 브라우저→서버 연결 상태이며 별개임.

### AgentCreateModal

```
┌─────────────────────────────────┐
│  새 에이전트 추가                  │
│                                 │
│  프로필 사진: [파일 선택] 🖼        │
│                                 │
│  이름: [                      ] │
│                                 │
│  역할 (Identity):               │
│  [                            ] │
│  [                            ] │
│                                 │
│  성격 (Soul):                   │
│  [                            ] │
│  [                            ] │
│                                 │
│  ⚠️ OpenClaw 연결 필요 (비활성)   │
│                                 │
│              [취소]  [생성]      │
└─────────────────────────────────┘
```

**동작:**
1. 파일 선택 시 즉시 `POST /api/agents/upload` 호출 → UUID 기반 URL 반환 → 폼 상태에 저장
2. [생성] 클릭 시 `POST /api/agents` 호출 (profileImage URL 포함)
3. 성공 시 모달 닫힘 + 패널 목록 갱신
4. OpenClaw 미연결 시 [생성] 버튼 비활성화 + 경고 표시

### GameWrapper 레이아웃

```tsx
<div style={{ display: "flex", alignItems: "flex-start" }}>
  <div ref={gameRef} />
  <AgentPanel />
</div>
```

---

## Docker 볼륨 변경

`public/uploads/`는 런타임에 생성되므로 Docker 볼륨 마운트 필요.
`docker-compose.yml`에 추가:

```yaml
volumes:
  - clawoffice_uploads:/app/public/uploads
```

기존 `clawoffice_device` 볼륨과 함께 선언.

> `data/agents.json`은 기존 `clawoffice_device:/app/data` 볼륨에 이미 포함됨. 별도 볼륨 불필요.

---

## 변경 파일 요약

### 새로 생성

| 파일 | 역할 |
|------|------|
| `src/server/agent-file-store.js` | `data/agents.json` CRUD + withLock + atomic write |
| `src/app/api/agents/route.ts` | GET, POST |
| `src/app/api/agents/[id]/route.ts` | DELETE |
| `src/app/api/agents/upload/route.ts` | 이미지 업로드 |
| `src/app/api/gateway/status/route.ts` | 연결 상태 조회 |
| `src/components/AgentPanel.tsx` | 사이드패널 + 모달 |

### 수정

| 파일 | 변경 내용 |
|------|----------|
| `openclaw-gateway.js` | `_pending`, `_rpcRequest`, `agentsCreate`, `agentsFileSet`, `agentsDelete`, `isConnected`, `_handleMessage` res 처리 추가 |
| `gateway-manager.js` | `global.__clawGateway` 싱글턴, `agentFileStore` 복원, `gateway` export |
| `src/game/config.ts` | `DESK_POSITIONS` → `DESK_SLOTS` 교체 |
| `src/game/sprites/AgentSprite.ts` | `deskPos` 필드 추가, `getTargetPosition` 수정 |
| `src/game/scenes/OfficeScene.ts` | `deskIndex` 기반 슬롯 조회, `agent:removed` 처리 |
| `src/components/GameWrapper.tsx` | `AgentPanel` 추가, `agent:removed` Socket.io → EventBus 전달 |
| `src/types/agent.ts` | `AgentConfig` 추가, `AgentState.deskIndex` 추가 |
| `docker-compose.yml` | `clawoffice_uploads` 볼륨 추가 |
| `server.js` | `global.__clawIo = io` 추가 |
| `.env.local` | `OPENCLAW_WORKSPACE_ROOT` 추가 |

---

## Error Handling

| 상황 | 처리 |
|------|------|
| OpenClaw 미연결 | 503 반환, 모달 버튼 비활성화 |
| agentId 중복 | auto-suffix로 자동 해소 — 409 없음 |
| agentsCreate RPC 타임아웃 | rollback 시도(불확실) → 504, 사용자에게 "재시도" 안내 |
| IDENTITY/SOUL set 실패/타임아웃 | `agentsDelete` rollback → 502/504 |
| 이미지 업로드 실패 | profileImage=null로 에이전트 생성 계속 가능 |
| agents.json 손상 | `.bak` 백업 후 빈 배열 fallback + 경고 로그 |
| 데스크 슬롯 고갈 (4명 초과) | deskIndex=-1, 라운지 배치 |
| `public/uploads/` 디렉토리 없음 | 모듈 로드 시 `mkdirSync` 보장 — 런타임 에러 없음 |

---

## 명시적으로 이번 범위에서 제외

- `PATCH /api/agents/[id]` (에이전트 정보 수정) — 추후 구현
- 에이전트별 채팅/태스크 전송 — 추후 구현
