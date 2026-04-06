# ClawOffice — CLAUDE.md

## 프로젝트 개요
OpenClaw AI 에이전트 오케스트레이터의 하위 에이전트를 2D SD 캐릭터로 시각화하는 실시간 모니터링 웹앱.

## 기술 스택
- Next.js 15 (App Router) + React 19
- Phaser 3 (게임 렌더링, 브라우저 전용)
- Socket.io 4.x (server.js 통합 커스텀 서버)
- TypeScript + cross-env (Windows 호환)

## 빌드 & 배포
- **빌드 검증:** `npm run build` (TypeScript 컴파일 확인)
- **로컬 실행:** `npm run dev` = `node server.js` (Next.js 기본 서버 아님)
- **배포:** `main` 브랜치 push → GitHub Actions → `ghcr.io/sck1993/bizdevoffice:latest` → Hostinger 매니저에서 수동 업데이트

## 모듈 시스템 주의
- `src/server/*.js` — CommonJS (`require`/`module.exports`)
- `src/app/**`, `src/game/**`, `src/components/**`, `src/lib/**` — ESM TypeScript
- `src/server/` 파일들은 `src/game/config.ts` 등 ESM 모듈을 직접 import할 수 없다

## API Routes 필수 사항
모든 API route 파일 최상단에 반드시 있어야 한다:
```ts
export const runtime = "nodejs";
```
없으면 Next.js가 Edge Runtime으로 실행해 `fs`, `crypto` 등 Node.js 모듈이 실패한다.

## 아키텍처 — 이벤트 흐름
```
OpenClaw WebSocket
  → openclaw-gateway.js (EventEmitter)
  → gateway-manager.js (agentStateStore 업데이트 + io.emit)
  → Socket.io → 브라우저
  → GameWrapper.tsx (소켓 수신 → EventBus.emit)
  → OfficeScene.ts (Phaser) + AgentPanel.tsx (React)
```

## 전역 싱글턴
- `global.__clawGateway` — OpenClawGateway 인스턴스 (gateway-manager.js)
- `global.__clawIo` — Socket.io Server 인스턴스 (server.js에서 설정)

## 상태 관리 두 계층
| 계층 | 파일 | 용도 |
|------|------|------|
| 영속 | `src/server/agent-file-store.js` | `data/agents.json` CRUD, `withLock` 뮤텍스, atomic write |
| 런타임 | `src/server/agent-state-store.js` | `Map<agentId, AgentState>`, 서버 재시작 시 초기화 |

## 데스크 슬롯
- `DESK_SLOTS` (config.ts): 인덱스 0~3, 총 4개
- `deskIndex = -1` → 라운지 배치
- `agent-file-store.js`의 `DESK_SLOT_COUNT = 4`는 `DESK_SLOTS.length`와 일치해야 함

## Phaser 스프라이트 애니메이션 프레임
| 상태 | 프레임 범위 | 키 |
|------|-------------|-----|
| idle | 0–3 | `agent_idle` |
| working | 4–7 | `agent_working` |
| meeting | 8–11 | `agent_meeting` |

## 공통 유틸
- `src/lib/route-utils.ts` — API route에서 공유하는 `AgentRouteError`, `clawGlobal`, `jsonError`, `isTimeoutError`

## 경로 alias
`@/*` → `./src/*` (tsconfig.json)

## 테스트 없음
검증은 `npm run build` 빌드 통과 여부로 확인한다.
