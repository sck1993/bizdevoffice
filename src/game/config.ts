// 게임 캔버스 기준 해상도
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 640;

// 바닥 영역 전체를 80×80 타일로 분할 (편집 모드 스냅 기준)
export const TILE_GRID = {
  originX: 44,
  originY: 134,
  tileW: 80,
  tileH: 80,
  cols: 15,
  rows: 6,
} as const;

export function tileToPixel(col: number, row: number): { x: number; y: number } {
  return {
    x: TILE_GRID.originX + col * TILE_GRID.tileW + TILE_GRID.tileW / 2,
    y: TILE_GRID.originY + row * TILE_GRID.tileH + TILE_GRID.tileH / 2,
  };
}

export function pixelToTile(x: number, y: number): { col: number; row: number } {
  return {
    col: Math.max(0, Math.min(TILE_GRID.cols - 1, Math.floor((x - TILE_GRID.originX) / TILE_GRID.tileW))),
    row: Math.max(0, Math.min(TILE_GRID.rows - 1, Math.floor((y - TILE_GRID.originY) / TILE_GRID.tileH))),
  };
}
