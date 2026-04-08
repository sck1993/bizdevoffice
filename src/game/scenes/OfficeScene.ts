import * as Phaser from "phaser";
import { EventBus } from "../EventBus";
import { GAME_HEIGHT, GAME_WIDTH, TILE_GRID, tileToPixel } from "../config";
import { AgentSprite } from "../sprites/AgentSprite";
import type { AgentRemoved, AgentState, AgentStateChanged, AgentsSnapshot } from "../../types/agent";
import type { OfficeConfig, OfficeProp, PropType } from "../../types/office";

function stableLoungeIndex(agentId: string, seatCount: number): number {
  return agentId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % Math.max(1, seatCount);
}

const INITIAL_LOUNGE_SPAWN = {
  minX: 96,
  maxX: 540,
  minY: 432,
  maxY: 560,
  minDistance: 72,
};


// 소품 타일 크기 (tileCol/tileRow 는 좌상단 기준)
const PROP_SIZE: Record<PropType, { w: number; h: number }> = {
  desk:          { w: 1, h: 1 },
  meeting_chair: { w: 1, h: 1 },
  sofa:          { w: 1, h: 1 },
  lounge_table:  { w: 1, h: 1 },
  meeting_table:  { w: 2, h: 2 },
  plant:          { w: 1, h: 1 },
  bookshelf:      { w: 2, h: 1 },
  whiteboard:     { w: 1, h: 1 },
  coffee_machine: { w: 1, h: 1 },
  water_cooler:   { w: 1, h: 1 },
  long_sofa:      { w: 2, h: 1 },
  tv:             { w: 2, h: 1 },
  filing_cabinet: { w: 1, h: 1 },
};

function propCenter(col: number, row: number, pw: number, ph: number): { x: number; y: number } {
  return {
    x: TILE_GRID.originX + col * TILE_GRID.tileW + (pw * TILE_GRID.tileW) / 2,
    y: TILE_GRID.originY + row * TILE_GRID.tileH + (ph * TILE_GRID.tileH) / 2,
  };
}

export class OfficeScene extends Phaser.Scene {
  private agents = new Map<string, AgentSprite>();
  private meetingOccupied: (string | null)[] = [];

  // ── 오피스 config ──
  private currentConfig: OfficeConfig = { props: [] };
  private propObjects = new Map<string, Phaser.GameObjects.Container>();
  private gridGraphics: Phaser.GameObjects.Graphics | null = null;

  // ── 편집 모드 ──
  private isEditMode = false;
  private preEditConfig: OfficeConfig | null = null;
  private editDragHandler: ((pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.Container, dragX: number, dragY: number) => void) | null = null;

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
    this.drawBackdrop();
    this.drawZones();
    this.registerAnimations();

    // ── 이벤트 핸들러 ────────────────────────────────────────────────────────

    const handleSnapshot = (data: unknown) => {
      const { agents } = data as AgentsSnapshot;
      const snapshotIds = new Set(agents.map((a) => a.agentId));

      // 스냅샷에 없는 스프라이트 제거 (삭제된 에이전트 정리)
      this.agents.forEach((sprite, agentId) => {
        if (!snapshotIds.has(agentId)) {
          this.releaseMeetingSeat(agentId);
          sprite.destroy();
          this.agents.delete(agentId);
        }
      });

      agents.forEach((agent) => {
        const existing = this.agents.get(agent.agentId);
        if (!existing) {
          this.spawnAgent(agent);
          return;
        }

        existing.setAgentName(agent.name);
        existing.setAgentImage(agent.spriteImage, agent.spriteFrames);

        let meetingSeatIndex = -1;
        if (agent.state === "meeting") {
          meetingSeatIndex = this.claimMeetingSeat(agent.agentId);
        } else {
          this.releaseMeetingSeat(agent.agentId);
        }

        existing.setAgentState(agent.state, { taskTitle: agent.taskTitle, meetingSeatIndex });
      });
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

    const handleAgentRemoved = (data: unknown) => {
      const { agentId } = data as AgentRemoved;
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

    const handleOfficeConfig = (data: unknown) => {
      if (this.isEditMode) return;
      const config = data as OfficeConfig;
      this.currentConfig = config;
      this.meetingOccupied = config.props.filter((p) => p.type === "meeting_chair").map(() => null);
      this.renderProps(config);
      this.updateAllSpritePositions();
    };

    const handleEditStart = () => this.enterEditMode();
    const handleEditSave = () => this.exitEditMode(true);
    const handleEditCancel = () => this.exitEditMode(false);
    const handleAddProp = (data: unknown) => this.addProp((data as { type: PropType }).type);

    const handleMeetingTurnStart = (data: unknown) => {
      const { agentId } = data as { agentId: string };
      this.agents.get(agentId)?.showSpeechBubble();
    };

    const handleMeetingSpeechChunk = (data: unknown) => {
      const { agentId, chunk } = data as { agentId: string; chunk: string };
      this.agents.get(agentId)?.appendSpeechChunk(chunk);
    };

    const handleMeetingTurnEnd = (data: unknown) => {
      const { agentId } = data as { agentId: string };
      this.time.delayedCall(1500, () => {
        this.agents.get(agentId)?.hideSpeechBubble();
      });
    };

    const handleMeetingEnded = () => {
      this.agents.forEach((sprite) => sprite.hideSpeechBubble());
    };

    // 오류 시에도 말풍선 즉시 정리 (finally에서 meeting:ended가 뒤따라 오지만, 즉각 처리)
    const handleMeetingError = () => {
      this.agents.forEach((sprite) => sprite.hideSpeechBubble());
    };

    EventBus.on("agents:snapshot", handleSnapshot);
    EventBus.on("agent:state-changed", handleStateChanged);
    EventBus.on("agent:removed", handleAgentRemoved);
    EventBus.on("connection:lost", handleConnectionLost);
    EventBus.on("connection:restored", handleConnectionRestored);
    EventBus.on("office:config", handleOfficeConfig);
    EventBus.on("office:edit-start", handleEditStart);
    EventBus.on("office:edit-save", handleEditSave);
    EventBus.on("office:edit-cancel", handleEditCancel);
    EventBus.on("office:add-prop", handleAddProp);
    EventBus.on("meeting:turn-start", handleMeetingTurnStart);
    EventBus.on("meeting:speech-chunk", handleMeetingSpeechChunk);
    EventBus.on("meeting:turn-end", handleMeetingTurnEnd);
    EventBus.on("meeting:ended", handleMeetingEnded);
    EventBus.on("meeting:error", handleMeetingError);

    this.events.once("shutdown", () => {
      EventBus.off("agents:snapshot", handleSnapshot);
      EventBus.off("agent:state-changed", handleStateChanged);
      EventBus.off("agent:removed", handleAgentRemoved);
      EventBus.off("connection:lost", handleConnectionLost);
      EventBus.off("connection:restored", handleConnectionRestored);
      EventBus.off("office:config", handleOfficeConfig);
      EventBus.off("office:edit-start", handleEditStart);
      EventBus.off("office:edit-save", handleEditSave);
      EventBus.off("office:edit-cancel", handleEditCancel);
      EventBus.off("office:add-prop", handleAddProp);
      EventBus.off("meeting:turn-start", handleMeetingTurnStart);
      EventBus.off("meeting:speech-chunk", handleMeetingSpeechChunk);
      EventBus.off("meeting:turn-end", handleMeetingTurnEnd);
      EventBus.off("meeting:ended", handleMeetingEnded);
      EventBus.off("meeting:error", handleMeetingError);
    });
  }

  // ── BACKDROP ────────────────────────────────────────────────────────────────

  private drawBackdrop() {
    this.cameras.main.setBackgroundColor("#0c1018");

    const floor = this.add.graphics();
    floor.fillStyle(0xa07850, 1);
    floor.fillRect(42, 230, GAME_WIDTH - 84, GAME_HEIGHT - 246);

    const planks = this.add.graphics();
    planks.lineStyle(1, 0x7e5d38, 0.32);
    for (let y = 250; y < GAME_HEIGHT - 16; y += 22) {
      planks.lineBetween(42, y, GAME_WIDTH - 42, y);
    }

    const seams = this.add.graphics();
    seams.lineStyle(1, 0x7e5d38, 0.22);
    for (let row = 0; row < 20; row++) {
      const y = 230 + row * 22;
      const xOffset = (row % 3) * 80;
      for (let x = 42 + xOffset; x < GAME_WIDTH - 42; x += 240) {
        seams.lineBetween(x, y, x, y + 22);
      }
    }

    const wallFloorShadow = this.add.graphics();
    wallFloorShadow.fillStyle(0x000000, 0.2);
    wallFloorShadow.fillRect(42, 230, GAME_WIDTH - 84, 24);

    const wall = this.add.graphics();
    wall.fillStyle(0xd8d0c6, 1);
    wall.fillRect(42, 130, GAME_WIDTH - 84, 108);

    const wallHighlight = this.add.graphics();
    wallHighlight.fillStyle(0xffffff, 0.06);
    wallHighlight.fillRoundedRect(42, 130, GAME_WIDTH - 84, 30);

    const wallDark = this.add.graphics();
    wallDark.fillStyle(0x000000, 0.09);
    wallDark.fillRoundedRect(42, 212, GAME_WIDTH - 84, 26);

    const baseboard = this.add.graphics();
    baseboard.fillStyle(0xb2aaa0, 1);
    baseboard.fillRect(42, 227, GAME_WIDTH - 84, 6);

    this.drawWindow(110, 140, 140, 74);
    this.drawWindow(390, 140, 160, 74);
    this.drawWindow(680, 140, 160, 74);
    this.drawWindow(980, 140, 160, 74);

    const ceiling = this.add.graphics();
    ceiling.fillStyle(0x181d2c, 1);
    ceiling.fillRoundedRect(14, 14, GAME_WIDTH - 28, 124, { tl: 18, tr: 18, bl: 0, br: 0 });

    const ceilEdge = this.add.graphics();
    ceilEdge.fillStyle(0x252d42, 1);
    ceilEdge.fillRect(14, 128, GAME_WIDTH - 28, 6);

    const lightXList = [200, 470, 740, 1010];
    lightXList.forEach((lx) => {
      const housing = this.add.graphics();
      housing.fillStyle(0x1c2538, 1);
      housing.fillRoundedRect(lx - 62, 28, 124, 18, 6);

      const tube = this.add.graphics();
      tube.fillStyle(0xfff6e0, 1);
      tube.fillRoundedRect(lx - 52, 34, 104, 8, 3);

      const cone = this.add.graphics();
      cone.fillStyle(0xfff6e0, 0.03);
      cone.fillTriangle(lx - 52, 42, lx + 52, 42, lx + 100, 132);
      cone.fillTriangle(lx - 52, 42, lx - 100, 132, lx + 100, 132);

      const pool = this.add.graphics();
      pool.fillStyle(0xfff6e0, 0.04);
      pool.fillEllipse(lx, 320, 230, 90);
    });

    const leftStrip = this.add.graphics();
    leftStrip.fillStyle(0x13181f, 1);
    leftStrip.fillRoundedRect(14, 14, 30, GAME_HEIGHT - 28, { tl: 18, tr: 0, bl: 18, br: 0 });

    const rightStrip = this.add.graphics();
    rightStrip.fillStyle(0x13181f, 1);
    rightStrip.fillRoundedRect(GAME_WIDTH - 44, 14, 30, GAME_HEIGHT - 28, { tl: 0, tr: 18, bl: 0, br: 18 });

    const bottomStrip = this.add.graphics();
    bottomStrip.fillStyle(0x13181f, 1);
    bottomStrip.fillRoundedRect(14, GAME_HEIGHT - 30, GAME_WIDTH - 28, 16, { tl: 0, tr: 0, bl: 18, br: 18 });

    const border = this.add.graphics();
    border.lineStyle(2, 0x2a3555, 0.7);
    border.strokeRoundedRect(14, 14, GAME_WIDTH - 28, GAME_HEIGHT - 28, 18);
  }

  private drawWindow(x: number, y: number, w: number, h: number) {
    const frame = this.add.graphics();
    frame.fillStyle(0xa09690, 1);
    frame.fillRoundedRect(x, y, w, h, 4);

    const sky = this.add.graphics();
    sky.fillStyle(0x7cb8de, 0.62);
    sky.fillRoundedRect(x + 4, y + 4, w - 8, h - 8, 3);

    const skyTop = this.add.graphics();
    skyTop.fillStyle(0xb4daf2, 0.42);
    skyTop.fillRoundedRect(x + 4, y + 4, w - 8, Math.floor((h - 8) * 0.45), 3);

    const divider = this.add.graphics();
    divider.fillStyle(0xa09690, 1);
    divider.fillRect(x + Math.floor(w / 2) - 2, y + 4, 4, h - 8);
    divider.fillRect(x + 4, y + Math.floor(h / 2), w - 8, 3);

    const spill = this.add.graphics();
    spill.fillStyle(0xb8dfff, 0.055);
    spill.fillEllipse(x + w / 2, y + h + 18, w + 16, 36);
  }

  // ── ZONES ───────────────────────────────────────────────────────────────────

  private drawZones() {
    const divider = this.add.graphics();
    divider.lineStyle(1, 0x2a3555, 0.6);
    divider.lineBetween(609, 134, 609, 618);

    this.drawWorkZone();
    this.drawLoungeZone();
    this.drawMeetingZone();
  }

  private drawWorkZone() {
    const zx = 24, zy = 134, zw = 580, zh = 232;

    const bg = this.add.graphics();
    bg.fillStyle(0x0e2848, 0.22);
    bg.fillRoundedRect(zx, zy, zw, zh, 20);

    const border = this.add.graphics();
    border.lineStyle(1.5, 0x4a9eff, 0.72);
    border.strokeRoundedRect(zx, zy, zw, zh, 20);

    const chip = this.add.graphics();
    chip.fillStyle(0x4a9eff, 0.32);
    chip.lineStyle(1, 0x4a9eff, 0.9);
    chip.fillRoundedRect(zx + 16, zy + 14, 116, 26, 13);
    chip.strokeRoundedRect(zx + 16, zy + 14, 116, 26, 13);
    chip.setDepth(3);

    this.add.text(zx + 26, zy + 18, "Work Zone", {
      fontSize: "13px",
      fontStyle: "bold",
      color: "#c0deff",
    }).setDepth(3);
  }

  private drawMeetingZone() {
    const zx = 615, zy = 134, zw = 641, zh = 484;

    const bg = this.add.graphics();
    bg.fillStyle(0x0e2820, 0.22);
    bg.fillRoundedRect(zx, zy, zw, zh, 20);

    const border = this.add.graphics();
    border.lineStyle(1.5, 0x5ec99a, 0.72);
    border.strokeRoundedRect(zx, zy, zw, zh, 20);

    const chip = this.add.graphics();
    chip.fillStyle(0x5ec99a, 0.32);
    chip.lineStyle(1, 0x5ec99a, 0.9);
    chip.fillRoundedRect(zx + 16, zy + 14, 138, 26, 13);
    chip.strokeRoundedRect(zx + 16, zy + 14, 138, 26, 13);
    chip.setDepth(3);

    this.add.text(zx + 26, zy + 18, "Meeting Zone", {
      fontSize: "13px",
      fontStyle: "bold",
      color: "#b0ead0",
    }).setDepth(3);
  }

  private drawLoungeZone() {
    const zx = 24, zy = 378, zw = 580, zh = 240;

    const bg = this.add.graphics();
    bg.fillStyle(0x28180e, 0.22);
    bg.fillRoundedRect(zx, zy, zw, zh, 20);

    const border = this.add.graphics();
    border.lineStyle(1.5, 0xff9a56, 0.72);
    border.strokeRoundedRect(zx, zy, zw, zh, 20);

    const chip = this.add.graphics();
    chip.fillStyle(0xff9a56, 0.32);
    chip.lineStyle(1, 0xff9a56, 0.9);
    chip.fillRoundedRect(zx + 16, zy + 14, 128, 26, 13);
    chip.strokeRoundedRect(zx + 16, zy + 14, 128, 26, 13);
    chip.setDepth(3);

    this.add.text(zx + 26, zy + 18, "Lounge Zone", {
      fontSize: "13px",
      fontStyle: "bold",
      color: "#ffd4b0",
    }).setDepth(3);
  }


  // ── ANIMATIONS ──────────────────────────────────────────────────────────────

  private registerAnimations() {
    const texture = this.textures.get("character");
    const numericFrames = texture
      .getFrameNames()
      .filter((name) => name !== "__BASE")
      .map((name) => Number(name))
      .filter((name) => Number.isFinite(name))
      .sort((a, b) => a - b);

    const fallbackFrame = numericFrames[0] ?? 0;

    this.createAnimation("agent_idle", numericFrames.filter((f) => f >= 0 && f <= 3), fallbackFrame, 6);
    this.createAnimation("agent_working", numericFrames.filter((f) => f >= 4 && f <= 7), fallbackFrame, 8);
    this.createAnimation("agent_meeting", numericFrames.filter((f) => f >= 8 && f <= 11), fallbackFrame, 6);
  }

  private createAnimation(key: string, frames: number[], fallbackFrame: number, frameRate: number) {
    if (this.anims.exists(key)) return;

    const safeFrames = (frames.length > 0 ? frames : [fallbackFrame]).map((frame) => ({
      key: "character",
      frame,
    }));

    this.anims.create({ key, frames: safeFrames, frameRate, repeat: -1 });
  }

  // ── PROP CONFIG ─────────────────────────────────────────────────────────────

  private getPropPositions(): {
    deskPositions: { x: number; y: number }[];
    meetingSeats: { x: number; y: number }[];
    loungeSeats: { x: number; y: number }[];
  } {
    const deskPositions: { x: number; y: number }[] = [];
    const meetingSeats: { x: number; y: number }[] = [];
    const loungeSeats: { x: number; y: number }[] = [];

    for (const p of this.currentConfig.props) {
      const pos = tileToPixel(p.tileCol, p.tileRow);
      if (p.type === "desk") deskPositions.push(pos);
      else if (p.type === "meeting_chair") meetingSeats.push(pos);
      else loungeSeats.push(pos);
    }

    return {
      deskPositions,
      meetingSeats,
      loungeSeats: loungeSeats.length > 0 ? loungeSeats : [{ x: 130, y: 520 }],
    };
  }

  private drawCoffeeMachineAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 본체
    g.fillStyle(0x252530, 1);
    g.fillRoundedRect(x - 20, y - 24, 40, 44, 5);
    // 물탱크 (반투명 파란색)
    g.fillStyle(0x3a7aaa, 0.75);
    g.fillRect(x - 10, y - 36, 20, 14);
    g.fillStyle(0x3a7aaa, 0.75);
    g.fillEllipse(x, y - 22, 20, 8);
    g.fillStyle(0x3a7aaa, 0.75);
    g.fillEllipse(x, y - 36, 20, 8);
    g.fillStyle(0x88ccee, 0.35);
    g.fillEllipse(x - 2, y - 37, 9, 4);
    // 컨트롤 패널
    g.fillStyle(0x151520, 1);
    g.fillRoundedRect(x - 16, y - 8, 32, 16, 3);
    // 버튼 3개
    g.fillStyle(0xff6b6b, 1); g.fillCircle(x - 8, y, 3);
    g.fillStyle(0x4caf50, 1); g.fillCircle(x,     y, 3);
    g.fillStyle(0x4a9eff, 1); g.fillCircle(x + 8, y, 3);
    // 드립 트레이
    g.fillStyle(0x3a3a48, 1);
    g.fillRoundedRect(x - 18, y + 10, 36, 8, 3);
    g.fillStyle(0x555568, 0.5);
    for (let i = -10; i <= 10; i += 6) g.fillRect(x + i - 1, y + 11, 3, 5);
  }

  private drawWaterCoolerAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 물통 원기둥
    g.fillStyle(0x3a8aee, 0.6);
    g.fillRect(x - 11, y - 34, 22, 16);
    g.fillStyle(0x3a8aee, 0.6);
    g.fillEllipse(x, y - 18, 22, 9);
    g.fillStyle(0x3a8aee, 0.6);
    g.fillEllipse(x, y - 34, 22, 9);
    g.fillStyle(0x88ccff, 0.3);
    g.fillEllipse(x - 2, y - 35, 9, 4);
    // 캡
    g.fillStyle(0x1a55aa, 1);
    g.fillEllipse(x, y - 38, 16, 7);
    // 몸체
    g.fillStyle(0xdde4ee, 1);
    g.fillRoundedRect(x - 16, y - 16, 32, 36, 5);
    // 하단 짙은 베이스
    g.fillStyle(0xbbc4d4, 1);
    g.fillRoundedRect(x - 16, y + 12, 32, 8, { tl: 0, tr: 0, bl: 5, br: 5 });
    // 수도꼭지 패널
    g.fillStyle(0xc8d2e0, 1);
    g.fillRoundedRect(x - 12, y - 6, 24, 16, 3);
    g.fillStyle(0xff6b6b, 1); g.fillRoundedRect(x - 9, y - 2, 7, 4, 2);
    g.fillStyle(0x4a9eff, 1); g.fillRoundedRect(x + 2, y - 2, 7, 4, 2);
  }

  private drawLongSofaAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 2x1 = 160x80 영역, 팔걸이 (양쪽)
    g.fillStyle(0x7a4e28, 1);
    g.fillRoundedRect(x - 72, y - 16, 10, 28, 4);
    g.fillRoundedRect(x + 62, y - 16, 10, 28, 4);
    // 등받이
    g.fillStyle(0x8a5a30, 1);
    g.fillRoundedRect(x - 64, y - 18, 128, 16, 5);
    g.fillStyle(0xaa7a50, 0.28);
    g.fillRoundedRect(x - 62, y - 16, 124, 7, 4);
    // 쿠션 3개
    for (let i = -1; i <= 1; i++) {
      const cx = x + i * 42;
      g.fillStyle(0xaa7a50, 1);
      g.fillRoundedRect(cx - 19, y - 4, 38, 18, 5);
      g.fillStyle(0xca9a70, 0.38);
      g.fillRoundedRect(cx - 17, y - 2, 30, 6, 4);
    }
  }

  private drawTvAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 2x1 = 160x80 영역, 스탠드
    g.fillStyle(0x3a3a45, 1);
    g.fillRect(x - 3, y + 14, 6, 12);
    g.fillRoundedRect(x - 22, y + 24, 44, 6, 3);
    // 베젤
    g.fillStyle(0x1a1a22, 1);
    g.fillRoundedRect(x - 68, y - 26, 136, 42, 6);
    // 화면
    g.fillStyle(0x0c1828, 1);
    g.fillRoundedRect(x - 63, y - 22, 126, 34, 3);
    // 바 차트
    g.fillStyle(0x1a3a6a, 0.9);
    g.fillRect(x - 58, y - 18, 52, 26);
    const bars = [6, 12, 18, 10, 14, 8];
    bars.forEach((h, i) => {
      g.fillStyle(0x4a9eff, 0.85);
      g.fillRect(x - 55 + i * 8, y + 6 - h, 5, h);
    });
    // 텍스트 라인
    g.fillStyle(0x88bbff, 0.55);
    g.fillRect(x + 2, y - 16, 52, 3);
    g.fillRect(x + 2, y - 9,  40, 3);
    g.fillRect(x + 2, y - 2,  46, 3);
    g.fillRect(x + 2, y + 5,  32, 3);
    // 파워 LED
    g.fillStyle(0x4caf50, 1);
    g.fillCircle(x + 58, y + 12, 2);
  }

  private drawFilingCabinetAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 본체
    g.fillStyle(0x7a8090, 1);
    g.fillRoundedRect(x - 24, y - 32, 48, 56, 4);
    // 측면 음영
    g.fillStyle(0x000000, 0.1);
    g.fillRoundedRect(x + 18, y - 32, 6, 56, { tl: 0, tr: 4, bl: 0, br: 4 });
    // 상단 엣지 하이라이트
    g.fillStyle(0x9aaabb, 1);
    g.fillRect(x - 24, y - 32, 48, 4);
    // 서랍 3칸
    for (let i = 0; i < 3; i++) {
      const dy = y - 24 + i * 18;
      g.fillStyle(0x8a9aaa, 1);
      g.fillRoundedRect(x - 20, dy, 40, 14, 2);
      // 손잡이
      g.fillStyle(0x4a5060, 1);
      g.fillRoundedRect(x - 7, dy + 5, 14, 4, 2);
      g.fillStyle(0xaabbcc, 0.45);
      g.fillRect(x - 5, dy + 6, 10, 1);
    }
  }

  // ── PROP OBJECTS ─────────────────────────────────────────────────────────────

  private renderProps(config: OfficeConfig) {
    this.propObjects.forEach((c) => c.destroy());
    this.propObjects.clear();
    config.props.forEach((prop) => {
      this.propObjects.set(prop.id, this.createPropObject(prop));
    });
  }

  private drawPropGraphic(g: Phaser.GameObjects.Graphics, type: PropType, x: number, y: number) {
    if (type === "desk") this.drawDeskAt(g, x, y);
    else if (type === "meeting_chair") this.drawChairAt(g, x, y);
    else if (type === "sofa") this.drawSofaAt(g, x, y);
    else if (type === "lounge_table") this.drawLoungeTableAt(g, x, y);
    else if (type === "meeting_table") this.drawMeetingTableAt(g, x, y);
    else if (type === "plant") this.drawPlantAt(g, x, y);
    else if (type === "bookshelf") this.drawBookshelfAt(g, x, y);
    else if (type === "whiteboard")     this.drawWhiteboardAt(g, x, y);
    else if (type === "coffee_machine") this.drawCoffeeMachineAt(g, x, y);
    else if (type === "water_cooler")   this.drawWaterCoolerAt(g, x, y);
    else if (type === "long_sofa")      this.drawLongSofaAt(g, x, y);
    else if (type === "tv")             this.drawTvAt(g, x, y);
    else if (type === "filing_cabinet") this.drawFilingCabinetAt(g, x, y);
  }

  private createPropObject(prop: OfficeProp): Phaser.GameObjects.Container {
    const { w, h } = PROP_SIZE[prop.type];
    const { x, y } = propCenter(prop.tileCol, prop.tileRow, w, h);

    // 그래픽은 컨테이너 기준 (0,0) 으로 그린다
    const g = this.add.graphics();
    this.drawPropGraphic(g, prop.type, 0, 0);

    // 삭제 버튼 (우상단, 편집 모드에서만 표시)
    const hw = (w * TILE_GRID.tileW) / 2 - 4;
    const hh = (h * TILE_GRID.tileH) / 2 - 4;

    const delBg = this.add.graphics();
    delBg.fillStyle(0xff4444, 0.9);
    delBg.fillCircle(hw, -hh, 10);
    delBg.setVisible(false);

    const delLabel = this.add.text(hw, -hh, "×", {
      fontSize: "13px",
      fontStyle: "bold",
      color: "#ffffff",
    }).setOrigin(0.5).setVisible(false);

    const delZone = this.add.zone(hw, -hh, 20, 20).setInteractive();

    const container = this.add.container(x, y, [g, delBg, delLabel, delZone]);
    container.setDepth(4);
    container.setData("propId", prop.id);
    container.setData("propType", prop.type);
    container.setData("tileCol", prop.tileCol);
    container.setData("tileRow", prop.tileRow);
    container.setData("tileW", w);
    container.setData("tileH", h);
    container.setData("delBg", delBg);
    container.setData("delLabel", delLabel);

    delZone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      if (this.isEditMode) this.deleteProp(prop.id);
    });

    return container;
  }

  private drawDeskAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 다리
    g.fillStyle(0x4a3020, 1);
    g.fillRect(x - 24, y + 12, 8, 10);
    g.fillRect(x + 16, y + 12, 8, 10);
    // 책상 측면 (두께감)
    g.fillStyle(0x3e2610, 1);
    g.fillRoundedRect(x - 28, y + 6, 56, 8, 2);
    // 책상 상판
    g.fillStyle(0x6a4c2e, 1);
    g.fillRoundedRect(x - 28, y - 14, 56, 22, 4);
    // 상판 하이라이트
    g.fillStyle(0x8a6a4e, 0.45);
    g.fillRoundedRect(x - 26, y - 12, 52, 8, 3);
    // 모니터 스탠드
    g.fillStyle(0x1a2030, 1);
    g.fillRect(x - 2, y - 24, 4, 12);
    // 모니터 본체
    g.fillStyle(0x1a2030, 1);
    g.fillRoundedRect(x - 14, y - 38, 28, 16, 3);
    // 모니터 화면
    g.fillStyle(0x3a6aaa, 0.85);
    g.fillRoundedRect(x - 12, y - 36, 24, 12, 2);
  }

  private drawChairAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 등받이
    g.fillStyle(0x1a5a3a, 1);
    g.fillRoundedRect(x - 12, y - 20, 24, 14, 4);
    g.fillStyle(0x3a7a5a, 0.4);
    g.fillRoundedRect(x - 10, y - 18, 20, 6, 3);
    // 좌석
    g.fillStyle(0x2a6a4a, 1);
    g.fillRoundedRect(x - 14, y - 8, 28, 20, 5);
    g.fillStyle(0x4a8a6a, 0.35);
    g.fillRoundedRect(x - 12, y - 6, 24, 7, 4);
    // 다리
    g.fillStyle(0x1a3a2a, 1);
    g.fillRect(x - 10, y + 12, 5, 8);
    g.fillRect(x + 5, y + 12, 5, 8);
  }

  private drawSofaAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 팔걸이
    g.fillStyle(0x7a4e28, 1);
    g.fillRoundedRect(x - 34, y - 16, 10, 28, 4);
    g.fillRoundedRect(x + 24, y - 16, 10, 28, 4);
    // 등받이
    g.fillStyle(0x8a5a30, 1);
    g.fillRoundedRect(x - 26, y - 18, 52, 16, 5);
    g.fillStyle(0xaa7a50, 0.3);
    g.fillRoundedRect(x - 24, y - 16, 48, 7, 4);
    // 쿠션
    g.fillStyle(0xaa7a50, 1);
    g.fillRoundedRect(x - 26, y - 4, 24, 18, 5);
    g.fillRoundedRect(x + 2, y - 4, 24, 18, 5);
    // 쿠션 하이라이트
    g.fillStyle(0xca9a70, 0.4);
    g.fillRoundedRect(x - 24, y - 2, 20, 6, 4);
    g.fillRoundedRect(x + 4, y - 2, 20, 6, 4);
  }

  private drawLoungeTableAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 그림자
    g.fillStyle(0x000000, 0.2);
    g.fillRoundedRect(x - 31, y + 7, 64, 12, 4);
    // 측면 (두께감)
    g.fillStyle(0x4a3020, 1);
    g.fillRoundedRect(x - 30, y + 4, 60, 8, 2);
    // 상판
    g.fillStyle(0x6a4c2e, 1);
    g.fillRoundedRect(x - 30, y - 8, 60, 14, 5);
    // 상판 하이라이트
    g.fillStyle(0xa07850, 0.42);
    g.fillRoundedRect(x - 27, y - 6, 54, 5, 3);
    // 다리
    g.fillStyle(0x3a2010, 1);
    g.fillRect(x - 22, y + 6, 5, 10);
    g.fillRect(x + 17, y + 6, 5, 10);
  }

  private drawMeetingTableAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 2x2 타일 = 160×160 px 영역, 중심 (x, y)
    // 그림자
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(x + 7, y + 14, 138, 68);
    // 측면 (두께감)
    g.fillStyle(0x3e2610, 1);
    g.fillEllipse(x, y + 7, 136, 66);
    // 상판
    g.fillStyle(0x6a4c2e, 1);
    g.fillEllipse(x, y, 136, 64);
    // 상판 하이라이트
    g.fillStyle(0xa07850, 0.38);
    g.fillEllipse(x - 4, y - 10, 100, 22);
  }

  private drawPlantAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 잎 (뒤)
    g.fillStyle(0x388e3c, 0.85);
    g.fillEllipse(x - 10, y - 13, 20, 13);
    g.fillEllipse(x + 10, y - 13, 20, 13);
    // 잎 (앞 중앙)
    g.fillStyle(0x4caf50, 0.95);
    g.fillEllipse(x, y - 18, 28, 18);
    // 잎 하이라이트
    g.fillStyle(0x7dcc60, 0.38);
    g.fillEllipse(x - 2, y - 21, 14, 7);
    // 줄기
    g.fillStyle(0x4a7a20, 1);
    g.fillRect(x - 1, y - 6, 2, 10);
    // 화분 테두리
    g.fillStyle(0x7a3510, 1);
    g.fillRoundedRect(x - 14, y + 2, 28, 4, 2);
    // 화분 몸통
    g.fillStyle(0xb05020, 1);
    g.fillRoundedRect(x - 12, y + 5, 24, 14, 3);
    // 화분 하이라이트
    g.fillStyle(0xff8050, 0.28);
    g.fillRoundedRect(x - 10, y + 7, 12, 4, 2);
  }

  private drawBookshelfAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 2x1 타일 = 160×80 px 영역, 중심 (x, y)
    g.fillStyle(0x7a5a38, 1);
    g.fillRoundedRect(x - 76, y - 36, 152, 72, 4);
    // 내부 배경
    g.fillStyle(0x2e2010, 1);
    g.fillRect(x - 72, y - 32, 144, 64);
    // 선반 칸막이
    g.fillStyle(0x7a5a38, 1);
    g.fillRect(x - 72, y - 1, 144, 3);
    // 윗 칸 책들
    const topBooks: { color: number; w: number }[] = [
      { color: 0x4a9eff, w: 11 }, { color: 0xff6b6b, w: 9  },
      { color: 0x5ec99a, w: 12 }, { color: 0xffd700, w: 8  },
      { color: 0xff9a56, w: 11 }, { color: 0xa855f7, w: 9  },
      { color: 0x06b6d4, w: 10 }, { color: 0xec4899, w: 8  },
      { color: 0xf97316, w: 11 }, { color: 0x84cc16, w: 9  },
    ];
    let bx = x - 70;
    topBooks.forEach(({ color, w }) => {
      g.fillStyle(color, 0.92);
      g.fillRect(bx, y - 29, w, 26);
      bx += w + 2;
    });
    // 아랫 칸 책들
    const botBooks: { color: number; w: number }[] = [
      { color: 0xe11d48, w: 12 }, { color: 0x0ea5e9, w: 10 },
      { color: 0x8b5cf6, w: 11 }, { color: 0x10b981, w: 9  },
      { color: 0xf59e0b, w: 12 }, { color: 0x6366f1, w: 10 },
      { color: 0xef4444, w: 9  }, { color: 0x22d3ee, w: 11 },
      { color: 0xa3e635, w: 10 },
    ];
    bx = x - 70;
    botBooks.forEach(({ color, w }) => {
      g.fillStyle(color, 0.92);
      g.fillRect(bx, y + 4, w, 26);
      bx += w + 2;
    });
  }

  private drawWhiteboardAt(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // 지지대
    g.fillStyle(0x3a4a5a, 1);
    g.fillRect(x - 4, y + 18, 4, 8);
    g.fillRect(x, y + 18, 4, 8);
    // 프레임
    g.fillStyle(0x4a5a6a, 1);
    g.fillRoundedRect(x - 32, y - 26, 64, 46, 4);
    // 보드 표면
    g.fillStyle(0xeef2ff, 1);
    g.fillRoundedRect(x - 29, y - 23, 58, 38, 2);
    // 텍스트 라인들
    g.lineStyle(1.5, 0x4a9eff, 0.7);
    g.lineBetween(x - 22, y - 14, x + 8, y - 14);
    g.lineBetween(x - 22, y - 7, x + 18, y - 7);
    g.lineBetween(x - 22, y, x + 2, y);
    // 차트 요소
    g.lineStyle(1.5, 0x5ec99a, 0.8);
    g.lineBetween(x + 8, y + 8, x + 13, y - 1);
    g.lineBetween(x + 13, y - 1, x + 18, y + 4);
    g.lineBetween(x + 18, y + 4, x + 23, y - 5);
    // 트레이
    g.fillStyle(0x2d3748, 1);
    g.fillRect(x - 29, y + 15, 58, 5);
  }

  // ── EDIT MODE ────────────────────────────────────────────────────────────────

  private showGrid() {
    if (!this.gridGraphics) {
      this.gridGraphics = this.add.graphics();
      this.gridGraphics.setDepth(5);
    }
    this.gridGraphics.clear();
    this.gridGraphics.lineStyle(1, 0xffffff, 0.12);

    for (let col = 0; col <= TILE_GRID.cols; col++) {
      const x = TILE_GRID.originX + col * TILE_GRID.tileW;
      this.gridGraphics.lineBetween(x, TILE_GRID.originY, x, TILE_GRID.originY + TILE_GRID.rows * TILE_GRID.tileH);
    }
    for (let row = 0; row <= TILE_GRID.rows; row++) {
      const y = TILE_GRID.originY + row * TILE_GRID.tileH;
      this.gridGraphics.lineBetween(TILE_GRID.originX, y, TILE_GRID.originX + TILE_GRID.cols * TILE_GRID.tileW, y);
    }
  }

  private hideGrid() {
    this.gridGraphics?.clear();
  }

  private enterEditMode() {
    if (this.isEditMode) return;
    this.isEditMode = true;
    this.preEditConfig = structuredClone(this.currentConfig);

    this.showGrid();

    this.propObjects.forEach((container) => {
      container.setAlpha(0.75);
      const pw = (container.getData("tileW") as number) ?? 1;
      const ph = (container.getData("tileH") as number) ?? 1;
      container.setSize(pw * TILE_GRID.tileW, ph * TILE_GRID.tileH);
      container.setInteractive();
      this.input.setDraggable(container);
      // 삭제 버튼 표시
      (container.getData("delBg") as Phaser.GameObjects.Graphics).setVisible(true);
      (container.getData("delLabel") as Phaser.GameObjects.Text).setVisible(true);
    });

    this.editDragHandler = (
      _pointer: Phaser.Input.Pointer,
      obj: Phaser.GameObjects.Container,
      dragX: number,
      dragY: number
    ) => {
      const pw = (obj.getData("tileW") as number) ?? 1;
      const ph = (obj.getData("tileH") as number) ?? 1;

      // 드래그 중심 → 좌상단 타일 계산
      const topLeftX = dragX - (pw * TILE_GRID.tileW) / 2;
      const topLeftY = dragY - (ph * TILE_GRID.tileH) / 2;
      const col = Math.max(0, Math.min(
        TILE_GRID.cols - pw,
        Math.floor((topLeftX - TILE_GRID.originX + TILE_GRID.tileW / 2) / TILE_GRID.tileW),
      ));
      const row = Math.max(0, Math.min(
        TILE_GRID.rows - ph,
        Math.floor((topLeftY - TILE_GRID.originY + TILE_GRID.tileH / 2) / TILE_GRID.tileH),
      ));

      if (this.isTileOccupied(col, row, obj.getData("propId") as string, pw, ph)) return;

      const snapped = propCenter(col, row, pw, ph);
      obj.setPosition(snapped.x, snapped.y);
      obj.setData("tileCol", col);
      obj.setData("tileRow", row);
    };
    this.input.on("drag", this.editDragHandler);
  }

  private exitEditMode(save: boolean) {
    if (!this.isEditMode) return;
    this.isEditMode = false;

    this.hideGrid();

    if (this.editDragHandler) {
      this.input.off("drag", this.editDragHandler);
      this.editDragHandler = null;
    }
    this.propObjects.forEach((container) => {
      container.setAlpha(1);
      this.input.setDraggable(container, false);
      // 삭제 버튼 숨김
      (container.getData("delBg") as Phaser.GameObjects.Graphics).setVisible(false);
      (container.getData("delLabel") as Phaser.GameObjects.Text).setVisible(false);
    });

    if (save) {
      const newProps: OfficeProp[] = [];
      this.propObjects.forEach((container, propId) => {
        newProps.push({
          id: propId,
          type: container.getData("propType") as PropType,
          tileCol: container.getData("tileCol") as number,
          tileRow: container.getData("tileRow") as number,
        });
      });
      const newConfig: OfficeConfig = { props: newProps };
      this.currentConfig = newConfig;
      this.meetingOccupied = newProps.filter((p) => p.type === "meeting_chair").map(() => null);
      this.updateAllSpritePositions();
      // 드래그된 최종 위치로 그래픽 재생성
      this.renderProps(newConfig);
      EventBus.emit("office:config-updated", newConfig);
    } else {
      // 취소: 저장된 위치로 복원
      if (this.preEditConfig) {
        this.currentConfig = this.preEditConfig;
        this.renderProps(this.preEditConfig);
      }
    }

    this.preEditConfig = null;
  }

  private isTileOccupied(col: number, row: number, excludeId: string, pw = 1, ph = 1): boolean {
    // 후보 소품이 점유할 타일 집합
    const candidates = new Set<string>();
    for (let r = row; r < row + ph; r++)
      for (let c = col; c < col + pw; c++)
        candidates.add(`${c},${r}`);

    for (const [id, container] of this.propObjects) {
      if (id === excludeId) continue;
      const eCol = container.getData("tileCol") as number;
      const eRow = container.getData("tileRow") as number;
      const ePw  = (container.getData("tileW") as number) ?? 1;
      const ePh  = (container.getData("tileH") as number) ?? 1;
      for (let r = eRow; r < eRow + ePh; r++)
        for (let c = eCol; c < eCol + ePw; c++)
          if (candidates.has(`${c},${r}`)) return true;
    }
    return false;
  }

  private deleteProp(propId: string) {
    const container = this.propObjects.get(propId);
    if (!container) return;

    const propType = container.getData("propType") as PropType;

    // desk 점유 여부 확인
    if (propType === "desk") {
      const deskProps = this.currentConfig.props.filter((p) => p.type === "desk");
      const deskIdx = deskProps.findIndex((p) => p.id === propId);
      const isOccupied = [...this.agents.values()].some(
        (sprite) => sprite.currentStatus === "working" && sprite.deskIndex === deskIdx
      );
      if (isOccupied) {
        this.tweens.add({ targets: container, x: container.x + 6, duration: 50, yoyo: true, repeat: 3 });
        return;
      }
    }

    container.destroy();
    this.propObjects.delete(propId);

    this.currentConfig = {
      props: this.currentConfig.props.filter((p) => p.id !== propId),
    };
  }

  private addProp(type: PropType) {
    if (!this.isEditMode) return;

    const size = PROP_SIZE[type];

    // 비어있는 타일 탐색 (멀티타일 크기 고려)
    let foundCol = -1, foundRow = -1;
    outer: for (let row = 0; row <= TILE_GRID.rows - size.h; row++) {
      for (let col = 0; col <= TILE_GRID.cols - size.w; col++) {
        if (!this.isTileOccupied(col, row, "", size.w, size.h)) {
          foundCol = col;
          foundRow = row;
          break outer;
        }
      }
    }
    if (foundCol === -1) return;

    const newId = `${type}-${Date.now()}`;
    const newProp: OfficeProp = { id: newId, type, tileCol: foundCol, tileRow: foundRow };

    this.currentConfig = { props: [...this.currentConfig.props, newProp] };

    const obj = this.createPropObject(newProp);
    obj.setAlpha(0.75);
    obj.setSize(size.w * TILE_GRID.tileW, size.h * TILE_GRID.tileH);
    obj.setInteractive();
    this.input.setDraggable(obj);
    (obj.getData("delBg") as Phaser.GameObjects.Graphics).setVisible(true);
    (obj.getData("delLabel") as Phaser.GameObjects.Text).setVisible(true);
    this.propObjects.set(newId, obj);
  }

  // ── SPRITE 위치 동기화 ────────────────────────────────────────────────────

  private updateAllSpritePositions() {
    const { deskPositions, meetingSeats, loungeSeats } = this.getPropPositions();

    this.agents.forEach((sprite) => {
      const deskPos = deskPositions[sprite.deskIndex];
      sprite.updatePositionRefs(loungeSeats, meetingSeats, deskPos);
    });
  }

  private getInitialLoungeSpawnPosition(): { x: number; y: number } {
    const bounds = INITIAL_LOUNGE_SPAWN;
    const occupied = [...this.agents.values()].map((sprite) => ({ x: sprite.x, y: sprite.y }));

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = {
        x: Phaser.Math.Between(bounds.minX, bounds.maxX),
        y: Phaser.Math.Between(bounds.minY, bounds.maxY),
      };
      const overlaps = occupied.some(
        (point) => Phaser.Math.Distance.Between(point.x, point.y, candidate.x, candidate.y) < bounds.minDistance,
      );
      if (!overlaps) return candidate;
    }

    return {
      x: Phaser.Math.Between(bounds.minX, bounds.maxX),
      y: Phaser.Math.Between(bounds.minY, bounds.maxY),
    };
  }

  // ── AGENT LIFECYCLE ─────────────────────────────────────────────────────────

  private spawnAgent(state: AgentState) {
    if (this.agents.has(state.agentId)) return;

    const { deskPositions, meetingSeats, loungeSeats } = this.getPropPositions();
    const deskPos =
      state.deskIndex != null && state.deskIndex >= 0 ? deskPositions[state.deskIndex] : undefined;
    const shouldScatterInLounge = state.state !== "working";
    const startPos = shouldScatterInLounge
      ? this.getInitialLoungeSpawnPosition()
      : deskPos;

    const sprite = new AgentSprite({
      scene: this,
      agentId: state.agentId,
      name: state.name,
      initialStatus: state.state,
      startPos,
      loungeIndex: stableLoungeIndex(state.agentId, loungeSeats.length),
      loungeSeats,
      meetingSeats,
      deskPos,
      deskIndex: state.deskIndex,
      imageUrl: state.spriteImage,
      spriteFrames: state.spriteFrames,
    });

    this.agents.set(state.agentId, sprite);

    if (state.state === "idle") {
      return;
    }

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
    if (index !== -1) {
      this.meetingOccupied[index] = null;
    }
  }
}
