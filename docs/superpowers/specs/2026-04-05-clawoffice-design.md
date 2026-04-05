# ClawOffice — 설계 문서

**날짜**: 2026-04-05
**프로젝트**: ClawOffice — OpenClaw 에이전트 실시간 모니터링 웹앱

---

## 개요

OpenClaw(오픈클로) 인스턴스의 하위 에이전트들을 2D SD(Super Deformed) 캐릭터로 시각화하는 실시간 모니터링 웹앱. 에이전트의 상태(idle / working / meeting)가 변할 때마다 캐릭터가 대응하는 위치로 이동하고 애니메이션이 바뀐다. MVP는 읽기 전용 모니터링이며, 작업 지시는 기존 OpenClaw 대시보드에서 수행한다.

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 게임 렌더링 | Phaser 3 |
| UI 오버레이 | React 19 |
| 풀스택 프레임워크 | Next.js (App Router) |
| 실시간 통신 | Socket.io 4.x |
| OpenClaw 연결 | openclaw-gateway.js (deskrpg 참고) |
| 상태 관리 | 서버 메모리 (Map) — DB 없음 (MVP) |
| 배포 | Docker Compose (Hostinger VPS, OpenClaw와 동일 인스턴스) |

---

## 아키텍처

### 전체 흐름

```
┌─────────────────────────────────────────────┐
│  Browser                                    │
│  ┌─────────────┐    ┌────────────────────┐  │
│  │  React UI   │    │   Phaser3 Scene    │  │
│  │ (상태 오버레이) │◄──►│ (캐릭터/맵 렌더링)  │  │
│  └─────────────┘    └────────────────────┘  │
│           │                  │              │
│           └────── EventBus ──┘              │
│                     │                       │
│              Socket.io Client               │
└─────────────────────┼───────────────────────┘
                      │ WebSocket
┌─────────────────────┼───────────────────────┐
│  Next.js Server (Docker: clawoffice)        │
│              Socket.io Server               │
│            socket-handlers.ts               │
│         openclaw-gateway.js                 │
└─────────────────────┼───────────────────────┘
                      │ WebSocket RPC (Docker 내부망)
┌─────────────────────┼───────────────────────┐
│  OpenClaw (Docker: openclaw)                │
│  - 메인 에이전트 + 하위 에이전트 최대 5개          │
└─────────────────────────────────────────────┘
```

### 배포 구조 (docker-compose.yml)

```yaml
services:
  openclaw:
    image: openclaw/openclaw
    # 외부 미노출 — Docker 내부망만 사용

  clawoffice:
    build: ./clawoffice
    ports:
      - "3001:3000"
    environment:
      - OPENCLAW_URL=ws://openclaw:3000
    depends_on:
      - openclaw
```

OpenClaw를 외부에 노출하지 않고 Docker 내부 네트워크로 연결하여 보안을 확보한다.

---

## 맵 레이아웃

### 구조: 2행 오픈 플랜

```
┌──────────────────────────────────────────────┐
│  Row 1 (상단)                                 │
│  [🖥️A] [🖥️B]  │  📋 MEETING TABLE  [🌿]     │
│  [🖥️C] [🖥️D]  │       [E]                   │
├──────────────────────────────────────────────┤
│  Row 2 (하단) — LOUNGE                        │
│  🛋️ sofa-L   🛋️ sofa-M   🛋️ sofa-R   📺TV  │
└──────────────────────────────────────────────┘
```

- **Row 1 Left — Work Zone**: 2×2 데스크 배치 (에이전트 A·B·C·D)
- **Row 1 Right — Meeting Zone**: 회의 테이블 + 의자 (에이전트 E 및 meeting 상태 에이전트)
- **Row 2 전체 — Lounge**: 소파 3세트 + TV 상태보드. idle 에이전트가 자유롭게 배치

캐릭터는 X·Y 2D 자유이동. 배경은 PNG 이미지(직접 제작 예정), 캐릭터는 SD 치비 스타일 스프라이트시트.

---

## 에이전트 상태 시스템

### 상태 3종

| 상태 | 위치 | 스프라이트 애니메이션 | 전환 조건 |
|------|------|------------------|---------|
| `idle` | Row 2 라운지 (소파 중 하나) | 앉아서 대기 | 할당 task 없음 |
| `working` | Row 1 자기 데스크 | 타이핑 / 작업 | task `in_progress` |
| `meeting` | Row 1 미팅 테이블 | 회의 자세 | meeting 세션 참여 |

### 상태 전환 & 이동

상태가 바뀌면 Phaser3 tween으로 현재 위치 → 목표 위치를 부드럽게 이동한 뒤 해당 애니메이션을 재생한다.

```
idle → working:   라운지 소파 → 자기 데스크 (X·Y tween)
working → idle:   자기 데스크 → 라운지 소파 (X·Y tween)
* → meeting:      현재 위치  → 미팅 테이블 (X·Y tween)
meeting → *:      미팅 테이블 → 이전 상태 위치 (X·Y tween)
```

### OpenClaw 상태 감지 방법

`openclaw-gateway.js`(deskrpg 참고)는 OpenClaw에 WebSocket RPC로 상시 연결을 유지한다. OpenClaw의 task 이벤트 스트림(`chatStream`, task action 파싱)을 수신하여 에이전트별 상태를 추론한다.

- task `in_progress` 이벤트 수신 → 해당 에이전트 `working`으로 마킹
- task `complete` / 할당 없음 → `idle`
- meeting 세션 참여 이벤트 → `meeting`

감지된 상태는 **서버 메모리(Map<agentId, AgentState>)** 에 보관한다. SQLite는 MVP에서 사용하지 않으며, 서버 재시작 시 다음 OpenClaw 이벤트가 올 때까지 상태는 `idle`로 초기화된다.

### Socket 이벤트 (Server → Client)

```ts
// 에이전트 상태 변경
socket.emit("agent:state-changed", {
  agentId: string,
  state: "idle" | "working" | "meeting",
  taskTitle?: string,   // working일 때 현재 태스크 제목. 없으면 툴팁 미표시
})

// 초기 전체 상태 스냅샷 (접속 시, 서버 메모리 기준)
socket.emit("agents:snapshot", {
  agents: Array<{ agentId, name, state, taskTitle }>
})
```

### agentId → 데스크 위치 매핑

정적 config 객체로 관리. 에이전트 수가 5개를 초과하면 초과 에이전트는 라운지에만 표시(데스크 없음).

```ts
const DESK_POSITIONS: Record<string, { x: number, y: number }> = {
  "agent-id-a": { x: 120, y: 180 },
  "agent-id-b": { x: 280, y: 180 },
  "agent-id-c": { x: 120, y: 320 },
  "agent-id-d": { x: 280, y: 320 },
  // 5번째 에이전트: 데스크 없음 → idle/working 시 라운지 유지
}
```

### 미팅 테이블 좌석 배치

최대 5개 에이전트가 meeting 상태일 때 겹치지 않도록 테이블 주변 고정 오프셋 사용. 5개 초과 시 초과 에이전트는 라운지에 그대로 유지(이동 없음).

```ts
const MEETING_SEATS = [
  { x: 540, y: 200 }, { x: 620, y: 200 },
  { x: 540, y: 260 }, { x: 620, y: 260 },
  { x: 580, y: 230 }, // 5번째
]
```

### meeting 상태 트리거

OpenClaw의 chatStream에서 meeting 관련 이벤트(deskrpg의 `meeting:start` / `meeting:join` 상당 이벤트)를 수신하면 해당 에이전트를 `meeting`으로 전환. 구체적인 이벤트 필드는 `openclaw-gateway.js` 구현 시 OpenClaw 프로토콜 확인 후 확정.

### OpenClaw WebSocket RPC 끊김 처리

gateway RPC 연결이 끊기면 서버 메모리의 에이전트 상태를 마지막 값으로 유지(freeze). 재연결 성공 시 다음 이벤트부터 정상 갱신. 서버 재시작 시에는 전체 상태 idle 초기화.

---

## 프로젝트 구조

```
clawoffice/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # 메인 게임 페이지 (Phaser + React 마운트)
│   │   └── api/
│   │       └── socket/route.ts       # Socket.io 서버 초기화
│   ├── game/
│   │   ├── scenes/
│   │   │   └── OfficeScene.ts        # Phaser3 메인 씬 (맵·캐릭터 관리)
│   │   ├── sprites/
│   │   │   └── AgentSprite.ts        # 에이전트 캐릭터 클래스 (상태·이동·애니메이션)
│   │   └── EventBus.ts               # Phaser ↔ React 이벤트 브릿지
│   ├── server/
│   │   ├── socket-handlers.ts        # Socket.io 이벤트 핸들러
│   │   └── openclaw-gateway.js       # OpenClaw WebSocket RPC 클라이언트 (deskrpg 참고)
│   ├── components/
│   │   └── AgentStatusPanel.tsx      # 에이전트 상태 오버레이 UI
│   └── db/
│       └── schema.ts                 # 에이전트 메타정보·데스크 위치 설정 테이블
├── public/
│   └── assets/
│       ├── background/               # 오피스 배경 PNG
│       └── characters/               # SD 캐릭터 스프라이트시트
├── server.js                         # Next.js + Socket.io 커스텀 서버
├── docker-compose.yml
└── Dockerfile
```

---

## MVP 범위

**포함**
- OpenClaw 에이전트 상태 실시간 수신 및 캐릭터 반영
- idle / working / meeting 3가지 상태 애니메이션
- 상태 전환 시 X·Y tween 이동
- 캐릭터 클릭 시 현재 task 제목 툴팁 (taskTitle 없으면 툴팁 미표시)
- Socket.io 연결 끊김 시 전체 캐릭터 dim 처리 + "연결 끊김" 배너
- Docker Compose 배포 (OpenClaw와 동일 VPS)

**제외 (추후 확장)**
- 에이전트에 직접 작업 지시 (인터랙션)
- 인증/로그인
- 다중 채널 지원

---

## 참고

- [deskrpg](https://github.com/dandacompany/deskrpg) — OpenClaw 연결 방식 및 socket-handlers 구조 참고
- [OpenClaw Sub-Agents 문서](https://docs.openclaw.ai/tools/subagents)
- OpenClaw 하위 에이전트 최대 동시 실행 수: 5개 (maxChildrenPerAgent 기본값)
