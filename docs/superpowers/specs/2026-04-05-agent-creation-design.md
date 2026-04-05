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
  1. OpenClaw RPC: agents.create(name, workspace)
  2. OpenClaw RPC: agents.files.set(agentId, "IDENTITY.md", identity)
  3. OpenClaw RPC: agents.files.set(agentId, "SOUL.md", soul)
  4. data/agents.json 저장
  5. agentStateStore.set(agentId, { idle })
  6. Socket.io broadcast: agents:snapshot
       ↓
[OfficeScene]
  새 AgentSprite 스폰 → 데스크 슬롯 배정
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
    "profileImage": "/uploads/alice.png",
    "deskIndex": 0,
    "createdAt": "2026-04-05T00:00:00.000Z"
  }
]
```

**필드 설명:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `agentId` | string | 이름을 소문자+하이픈으로 변환한 ID |
| `name` | string | 표시 이름 |
| `identity` | string | IDENTITY.md로 OpenClaw에 주입되는 역할 지침 |
| `soul` | string | SOUL.md로 OpenClaw에 주입되는 성격 지침 |
| `profileImage` | string \| null | `/uploads/{filename}` 경로. 없으면 null |
| `deskIndex` | number | 데스크 슬롯 index (0~3). -1이면 데스크 없음 |
| `createdAt` | string | ISO 8601 생성 시각 |

### 데스크 슬롯

`config.ts`에 슬롯 4개를 배열로 정의. 에이전트 생성 시 빈 슬롯 중 가장 낮은 index 배정. 삭제 시 슬롯 반환.

```ts
export const DESK_SLOTS: { x: number; y: number }[] = [
  { x: 160, y: 210 },
  { x: 320, y: 210 },
  { x: 160, y: 295 },
  { x: 320, y: 295 },
];
```

기존 `DESK_POSITIONS` (`"main"` 키) 제거하고 `DESK_SLOTS`로 교체. `AgentSprite`와 `OfficeScene`은 `deskIndex`로 슬롯 조회.

---

## OpenClaw Gateway 변경

`openclaw-gateway.js`에 RPC 송신 메서드 추가.

### `_rpcRequest(method, params)`

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
    }, 30000);
    this._pending.set(id, { resolve, reject, timer });
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
  });
}
```

`_pending` Map은 `_handleMessage`의 `res` 타입 처리에서 resolve.

### 추가 메서드

```js
async agentsCreate(name, workspace) {
  return this._rpcRequest("agents.create", { name, workspace });
}

async agentsFileSet(agentId, name, content) {
  return this._rpcRequest("agents.files.set", { agentId, name, content });
}

async agentsDelete(agentId) {
  return this._rpcRequest("agents.delete", { agentId });
}

isConnected() {
  return this.ws?.readyState === WebSocket.OPEN;
}
```

### `gateway-manager.js`

gateway 인스턴스를 export해 API 라우트에서 직접 접근 가능하게 함.

```js
module.exports = { initGateway, gateway };
```

---

## API Endpoints

모두 Next.js App Router (`src/app/api/`) 기반.

### `GET /api/agents`
`data/agents.json` 읽어서 목록 반환.

```ts
// Response
{ agents: AgentConfig[] }
```

### `POST /api/agents`
에이전트 생성.

```ts
// Request body
{
  name: string;       // 필수
  identity: string;   // 필수
  soul: string;       // 필수
  profileImage?: string; // /uploads/... 경로 (선업로드 후 전달)
}

// Response
{ agent: AgentConfig }

// Error cases
// 400: name/identity/soul 누락
// 503: OpenClaw 미연결
// 409: agentId 중복
```

**처리 순서:**
1. agentId 생성 (`name.toLowerCase().replace(/\s+/g, "-")`)
2. 중복 확인
3. 빈 데스크 슬롯 배정
4. `gateway.agentsCreate(agentId, workspace)`
5. `gateway.agentsFileSet(agentId, "IDENTITY.md", identity)`
6. `gateway.agentsFileSet(agentId, "SOUL.md", soul)`
7. `agents.json` 저장
8. `agentStateStore.set(agentId, { agentId, name, state: "idle" })`
9. `io.emit("agents:snapshot", { agents: agentStateStore.getAll() })`

### `DELETE /api/agents/[id]`
에이전트 삭제.

**처리 순서:**
1. `agents.json`에서 대상 확인
2. `gateway.agentsDelete(agentId)`
3. `agents.json`에서 제거
4. `agentStateStore` 제거
5. `io.emit("agents:snapshot", ...)`

### `POST /api/agents/upload`
프로필 이미지 업로드.

- multipart/form-data, 필드명 `file`
- `public/uploads/{agentId}-{timestamp}.{ext}` 저장
- Response: `{ url: "/uploads/..." }`
- 허용 타입: image/jpeg, image/png, image/webp
- 최대 크기: 2MB

---

## 서버 재시작 시 복원

`gateway-manager.js`의 `initGateway()` 진입 시:

```js
// data/agents.json 읽어서 agentStateStore에 등록
const saved = agentFileStore.loadAll();
for (const agent of saved) {
  agentStateStore.set(agent.agentId, {
    agentId: agent.agentId,
    name: agent.name,
    state: "idle",
  });
}
```

health 이벤트로 들어오는 "main" 에이전트는 기존 로직 그대로 유지 (JSON에 없는 에이전트는 health 이벤트로 자동 등록).

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

- 에이전트 목록: `GET /api/agents` + Socket.io `agents:snapshot` 실시간 반영
- 프로필 이미지: `/uploads/...` 경로로 `<img>` 렌더링. 없으면 기본 아이콘
- 상태 표시: idle / working (taskTitle) / meeting

### AgentCreateModal

`[+ 에이전트 추가]` 클릭 시 표시.

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
│  ⚠️ OpenClaw 연결 필요            │
│                                 │
│              [취소]  [생성]      │
└─────────────────────────────────┘
```

**동작:**
1. 파일 선택 시 즉시 `POST /api/agents/upload` 호출 → URL 저장
2. [생성] 클릭 시 `POST /api/agents` 호출
3. 성공 시 모달 닫힘 + 패널 목록 갱신
4. OpenClaw 미연결 시 [생성] 버튼 비활성화 + 경고 표시

### GameWrapper 변경

`AgentPanel`을 게임 캔버스 오른쪽에 레이아웃으로 추가.

```tsx
<div style={{ display: "flex" }}>
  <div ref={gameRef} />
  <AgentPanel />
</div>
```

---

## OfficeScene 변경

`DESK_POSITIONS` → `DESK_SLOTS` 교체. `AgentSprite` 생성 시 `deskIndex`로 슬롯 좌표 조회.

```ts
// spawnAgent 변경
const deskPos = state.deskIndex >= 0 ? DESK_SLOTS[state.deskIndex] : undefined;
const sprite = new AgentSprite({
  scene: this,
  agentId: state.agentId,
  name: state.name,
  initialStatus: state.state,
  loungeIndex: index % 5,
  deskPos, // 명시적으로 전달
});
```

---

## 새로 생성되는 파일

| 파일 | 역할 |
|------|------|
| `src/server/agent-file-store.js` | `data/agents.json` CRUD |
| `src/app/api/agents/route.ts` | GET, POST |
| `src/app/api/agents/[id]/route.ts` | DELETE |
| `src/app/api/agents/upload/route.ts` | 이미지 업로드 |
| `src/components/AgentPanel.tsx` | 사이드패널 + 모달 |

## 수정되는 파일

| 파일 | 변경 내용 |
|------|----------|
| `openclaw-gateway.js` | `_rpcRequest`, `_pending`, `agentsCreate`, `agentsFileSet`, `agentsDelete`, `isConnected` 추가 |
| `gateway-manager.js` | `agentFileStore` 복원 로직 + `gateway` export |
| `src/game/config.ts` | `DESK_POSITIONS` → `DESK_SLOTS` 교체 |
| `src/game/sprites/AgentSprite.ts` | `deskPos` 파라미터로 슬롯 좌표 수신 |
| `src/game/scenes/OfficeScene.ts` | `deskIndex` 기반 슬롯 조회 |
| `src/components/GameWrapper.tsx` | `AgentPanel` 추가, 레이아웃 변경 |
| `src/types/agent.ts` | `AgentConfig` 타입 추가 |

---

## Error Handling

| 상황 | 처리 |
|------|------|
| OpenClaw 미연결 | API 503 반환, 모달에서 버튼 비활성화 |
| agentId 중복 | API 409 반환, 모달에서 에러 메시지 |
| 이미지 업로드 실패 | 이미지 없이 계속 생성 가능 |
| RPC 타임아웃(30초) | API 504 반환 |
| agents.json 손상 | 빈 배열로 fallback, 경고 로그 |
