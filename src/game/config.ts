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
