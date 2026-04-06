# ClawOffice

OpenClaw AI 에이전트 오케스트레이터의 하위 에이전트를 2D SD 캐릭터로 실시간 시각화하는 모니터링 웹앱.

## 기술 스택

- **Next.js 15** (App Router) + React 19
- **Phaser 3** — 게임 렌더링 (브라우저 전용, SSR 불가)
- **Socket.io 4.x** — 실시간 에이전트 상태 동기화
- **sharp** — 서버사이드 이미지 리사이징
- TypeScript + cross-env (Windows 호환)

## 실행 방법

```bash
npm install
npm run dev      # node server.js (Next.js 기본 서버 아님)
npm run build    # 빌드 검증 (TypeScript 컴파일)
```

## 배포 구조

```
git push main
  → GitHub Actions (/.github/workflows/)
  → Docker 이미지 빌드: ghcr.io/sck1993/bizdevoffice:latest
  → Hostinger VPS (72.62.252.35, 포트 3001→3000)
  → Hostinger 매니저에서 수동으로 "Update" 클릭 필요
```

> **주의**: GitHub Actions 워크플로우는 push마다 누적되지만, 무료 플랜 기준 스토리지 한도에 걸리지 않는 이상 기능상 불이익 없음. 단, Actions 탭이 지저분해질 수 있으므로 빌드 확인 후 오래된 run은 수동 삭제 권장.

---

## AI 바이브코딩 주의사항 (Gotchas)

### 1. Docker 볼륨 — 파일 영속성

컨테이너가 재시작되면 `public/` 디렉토리 포함 대부분 파일이 초기화된다.
영속적으로 유지해야 할 파일은 반드시 `data/` 디렉토리 안에 저장해야 한다.

```
clawoffice_device 볼륨 → /app/data  (영속)
그 외 디렉토리             (컨테이너 재시작 시 초기화)
```

- 업로드 이미지: `data/uploads/` (O) / `public/uploads/` (X)
- 에이전트 데이터: `data/agents.json` (O)

### 2. 이미지 업로드 서빙 경로

업로드된 이미지는 `data/uploads/`에 저장되므로 Next.js의 `public/` 정적 파일 서빙을 사용할 수 없다.
별도 API route가 파일을 읽어서 응답한다:

```
POST /api/agents/upload  →  저장: data/uploads/{uuid}.png
GET  /api/uploads/{filename}  →  data/uploads/{filename} 파일 서빙
```

새로운 저장 경로로 마이그레이션 전에 업로드된 이미지 URL(`/uploads/...`)은 컨테이너 재시작 후 404가 된다.

### 3. agents.json 포맷

`data/agents.json`은 반드시 **배열**이어야 한다.

```json
// 올바른 형식
[]

// 잘못된 형식 (파싱 오류로 .bak 백업 후 빈 배열로 초기화됨)
{ "agents": [] }
```

파일이 손상되면 `agents.json.bak`으로 이름이 바뀌고 데이터가 초기화된다. 정기적으로 백업 권장.

### 4. sharp 패키지

`sharp`는 네이티브 모듈이라 `package.json`의 `dependencies`에 명시되어 있어야 한다.
로컬 머신에 전역 설치되어 있어도 Docker 빌드 시 `npm install`이 `package.json` 기준으로만 설치하므로 누락되면 컨테이너에서 크래시 발생.

```json
// package.json
"dependencies": {
  "sharp": "^0.34.5"
}
```

### 5. API Route — Node.js Runtime 강제 지정

`fs`, `crypto` 등 Node.js 모듈을 사용하는 모든 API route 최상단에 반드시 추가:

```ts
export const runtime = "nodejs";
```

없으면 Next.js가 Edge Runtime으로 실행해 Node.js 내장 모듈 사용 시 런타임 오류 발생.

### 6. 모듈 시스템 혼용

| 경로 | 모듈 시스템 |
|------|------------|
| `src/server/*.js` | CommonJS (`require` / `module.exports`) |
| `src/app/**`, `src/game/**`, `src/components/**` | ESM TypeScript |

`src/server/` 파일은 ESM 파일(예: `src/game/config.ts`)을 `require()`로 불러올 수 없다.
공유 상수가 필요하면 별도 `.js` 파일로 분리하거나 직접 값을 복사해서 사용.

### 7. Phaser 렌더링 — depth(깊이) 규칙

오브젝트가 겹칠 때 depth 값이 높은 쪽이 앞에 그려진다.

| 오브젝트 | depth |
|---------|-------|
| 배경 타일 | 0 |
| 소품(props) | 4 |
| 에이전트 스프라이트 | 10 |
| 에이전트 이름 라벨 | 11 |
| 에이전트 툴팁 | 12 |

에이전트가 소품 뒤에 가려지는 현상 = depth가 소품(4)보다 낮거나 같은 경우.

### 8. Phaser — 브라우저 전용

Phaser는 `window`, `document` 등 브라우저 API에 의존하므로 SSR에서 실행 불가.
동적 import로 브라우저에서만 로드해야 한다:

```ts
// GameWrapper.tsx
const Phaser = await import("phaser");
const { OfficeScene } = await import("../game/scenes/OfficeScene");
```

### 9. 이미지 계단 현상(aliasing) 대응

세 가지를 모두 적용해야 효과적이다:

1. **업로드 시 리사이징**: 표시 크기(80px)의 2배인 160×160으로 저장 (sharp)
2. **Phaser 텍스처 필터**: `Phaser.Textures.FilterMode.LINEAR` 적용
3. **Phaser 게임 설정**: `render: { antialias: true, roundPixels: false }`

### 10. OpenClaw 에이전트 필터링

OpenClaw 시스템은 내부 `main` 에이전트를 포함해 여러 에이전트를 관리한다.
ClawOffice 캔버스에는 **사용자가 직접 생성한 에이전트만** 표시하도록 필터링:

```js
// gateway-manager.js — syncAgentsFromHealth()
const fileAgent = savedMap.get(agentId);
if (!fileAgent) continue; // agents.json에 없는 에이전트는 무시
```

### 11. 데스크 슬롯 수 동기화

`DESK_SLOT_COUNT`는 두 곳에서 관리된다. 변경 시 반드시 둘 다 수정:

- `src/server/agent-file-store.js` → `DESK_SLOT_COUNT = 4`
- `src/game/config.ts` → `DESK_SLOTS` 배열 길이

---

## 아키텍처 이벤트 흐름

```
OpenClaw WebSocket
  → src/server/openclaw-gateway.js (EventEmitter)
  → src/server/gateway-manager.js  (agentStateStore 업데이트 + Socket.io emit)
  → Socket.io (server.js)
  → 브라우저 GameWrapper.tsx (소켓 수신 → EventBus.emit)
  → src/game/scenes/OfficeScene.ts (Phaser 렌더링)
  → src/components/AgentPanel.tsx  (React UI 사이드바)
```

## 상태 관리

| 계층 | 파일 | 용도 |
|------|------|------|
| 영속 | `src/server/agent-file-store.js` | `data/agents.json` CRUD, atomic write |
| 런타임 | `src/server/agent-state-store.js` | `Map<agentId, AgentState>`, 재시작 시 초기화 |

## 전역 싱글턴

- `global.__clawGateway` — OpenClawGateway 인스턴스
- `global.__clawIo` — Socket.io Server 인스턴스
