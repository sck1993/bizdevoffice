import * as Phaser from "phaser";
import { EventBus } from "../EventBus";
import { GAME_HEIGHT, GAME_WIDTH, TILE_GRID, tileToPixel, pixelToTile } from "../config";
import { AgentSprite } from "../sprites/AgentSprite";
import type { AgentRemoved, AgentState, AgentStateChanged, AgentsSnapshot } from "../../types/agent";
import type { OfficeConfig, OfficeProp, PropType } from "../../types/office";

function stableLoungeIndex(agentId: string, seatCount: number): number {
  return agentId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % Math.max(1, seatCount);
}

// prop 타입별 색상
const PROP_COLORS: Record<PropType, number> = {
  desk: 0x4a9eff,
  meeting_chair: 0x5ec99a,
  sofa: 0xff9a56,
};

const PROP_LABELS: Record<PropType, string> = {
  desk: "D",
  meeting_chair: "M",
  sofa: "S",
};

export class OfficeScene extends Phaser.Scene {
  private agents = new Map<string, AgentSprite>();
  private meetingOccupied: (string | null)[] = [];

  // ── 오피스 config ──
  private currentConfig: OfficeConfig = { props: [] };
  private propMarkers = new Map<string, Phaser.GameObjects.Container>();
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
      agents.forEach((agent) => {
        const existing = this.agents.get(agent.agentId);
        if (!existing) {
          this.spawnAgent(agent);
          return;
        }

        existing.setAgentName(agent.name);

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
      const config = data as OfficeConfig;
      this.currentConfig = config;
      this.meetingOccupied = config.props.filter((p) => p.type === "meeting_chair").map(() => null);
      this.renderPropMarkers(config);
      this.updateAllSpritePositions();
    };

    const handleEditStart = () => this.enterEditMode();
    const handleEditSave = () => this.exitEditMode(true);
    const handleEditCancel = () => this.exitEditMode(false);
    const handleAddProp = (data: unknown) => this.addProp((data as { type: PropType }).type);

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
    this.drawWindow(1158, 140, 110, 74);

    const ceiling = this.add.graphics();
    ceiling.fillStyle(0x181d2c, 1);
    ceiling.fillRoundedRect(14, 14, GAME_WIDTH - 28, 124, { tl: 18, tr: 18, bl: 0, br: 0 });

    const ceilEdge = this.add.graphics();
    ceilEdge.fillStyle(0x252d42, 1);
    ceilEdge.fillRect(14, 128, GAME_WIDTH - 28, 6);

    const lightXList = [200, 470, 740, 1010, 1200];
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
    border.lineStyle(1.5, 0x4a9eff, 0.48);
    border.strokeRoundedRect(zx, zy, zw, zh, 20);

    const chip = this.add.graphics();
    chip.fillStyle(0x4a9eff, 0.16);
    chip.lineStyle(1, 0x4a9eff, 0.52);
    chip.fillRoundedRect(zx + 16, zy + 14, 116, 26, 13);
    chip.strokeRoundedRect(zx + 16, zy + 14, 116, 26, 13);
    chip.setDepth(3);

    this.add.text(zx + 26, zy + 18, "Work Zone", {
      fontSize: "13px",
      fontStyle: "bold",
      color: "#88c4ff",
    }).setDepth(3);
  }

  private drawMeetingZone() {
    const zx = 615, zy = 134, zw = 641, zh = 484;
    const tableCx = zx + zw / 2;
    const tableCy = 390;

    const bg = this.add.graphics();
    bg.fillStyle(0x0e2820, 0.22);
    bg.fillRoundedRect(zx, zy, zw, zh, 20);

    const tableShadow = this.add.graphics();
    tableShadow.fillStyle(0x000000, 0.28);
    tableShadow.fillEllipse(tableCx + 7, tableCy + 16, 310, 116);

    const tableFront = this.add.graphics();
    tableFront.fillStyle(0x3e2610, 1);
    tableFront.fillEllipse(tableCx, tableCy + 10, 306, 112);

    const tableTop = this.add.graphics();
    tableTop.fillStyle(0x6a4c2e, 1);
    tableTop.fillEllipse(tableCx, tableCy, 306, 108);

    const tableHL = this.add.graphics();
    tableHL.fillStyle(0xa07850, 0.4);
    tableHL.fillEllipse(tableCx, tableCy - 12, 290, 62);

    const border = this.add.graphics();
    border.lineStyle(1.5, 0x5ec99a, 0.48);
    border.strokeRoundedRect(zx, zy, zw, zh, 20);

    const chip = this.add.graphics();
    chip.fillStyle(0x5ec99a, 0.16);
    chip.lineStyle(1, 0x5ec99a, 0.52);
    chip.fillRoundedRect(zx + 16, zy + 14, 138, 26, 13);
    chip.strokeRoundedRect(zx + 16, zy + 14, 138, 26, 13);
    chip.setDepth(3);

    this.add.text(zx + 26, zy + 18, "Meeting Zone", {
      fontSize: "13px",
      fontStyle: "bold",
      color: "#88d8b0",
    }).setDepth(3);
  }

  private drawLoungeZone() {
    const zx = 24, zy = 378, zw = 580, zh = 240;
    const sofaY = zy + 112;
    const ctCx  = zx + 290;

    const bg = this.add.graphics();
    bg.fillStyle(0x28180e, 0.22);
    bg.fillRoundedRect(zx, zy, zw, zh, 20);

    const ctShadow = this.add.graphics();
    ctShadow.fillStyle(0x000000, 0.22);
    ctShadow.fillRoundedRect(ctCx - 42, sofaY + 10, 84, 18, 6);

    const ctTop = this.add.graphics();
    ctTop.fillStyle(0x4a3220, 1);
    ctTop.fillRoundedRect(ctCx - 40, sofaY - 2, 80, 22, 6);

    const ctHL = this.add.graphics();
    ctHL.fillStyle(0x7a5a3a, 0.48);
    ctHL.fillRoundedRect(ctCx - 38, sofaY - 2, 76, 8, 5);

    const border = this.add.graphics();
    border.lineStyle(1.5, 0xff9a56, 0.48);
    border.strokeRoundedRect(zx, zy, zw, zh, 20);

    const chip = this.add.graphics();
    chip.fillStyle(0xff9a56, 0.16);
    chip.lineStyle(1, 0xff9a56, 0.52);
    chip.fillRoundedRect(zx + 16, zy + 14, 128, 26, 13);
    chip.strokeRoundedRect(zx + 16, zy + 14, 128, 26, 13);
    chip.setDepth(3);

    this.add.text(zx + 26, zy + 18, "Lounge Zone", {
      fontSize: "13px",
      fontStyle: "bold",
      color: "#ffbf96",
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

  // ── PROP MARKERS ────────────────────────────────────────────────────────────

  private renderPropMarkers(config: OfficeConfig) {
    // 기존 마커 제거
    this.propMarkers.forEach((c) => c.destroy());
    this.propMarkers.clear();

    config.props.forEach((prop) => {
      const marker = this.createPropMarker(prop);
      this.propMarkers.set(prop.id, marker);
    });
  }

  private createPropMarker(prop: OfficeProp): Phaser.GameObjects.Container {
    const { x, y } = tileToPixel(prop.tileCol, prop.tileRow);
    const color = PROP_COLORS[prop.type];
    const label = PROP_LABELS[prop.type];

    const bg = this.add.graphics();
    bg.fillStyle(color, 0.7);
    bg.fillRoundedRect(-20, -20, 40, 40, 8);
    bg.lineStyle(2, 0xffffff, 0.6);
    bg.strokeRoundedRect(-20, -20, 40, 40, 8);

    const text = this.add.text(0, 0, label, {
      fontSize: "14px",
      fontStyle: "bold",
      color: "#ffffff",
    }).setOrigin(0.5);

    // 삭제 버튼 (편집 모드에서만 표시)
    const delBg = this.add.graphics();
    delBg.fillStyle(0xff4444, 0.85);
    delBg.fillCircle(20, -20, 9);

    const delText = this.add.text(20, -20, "×", {
      fontSize: "12px",
      fontStyle: "bold",
      color: "#ffffff",
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, text, delBg, delText]);
    container.setDepth(10);
    container.setAlpha(0); // 편집 모드에서만 표시
    container.setData("propId", prop.id);
    container.setData("propType", prop.type);
    container.setData("tileCol", prop.tileCol);
    container.setData("tileRow", prop.tileRow);

    // 삭제 버튼 인터랙티브 영역
    const delZone = this.add.zone(20, -20, 18, 18).setInteractive();
    container.add(delZone);
    delZone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      if (this.isEditMode) this.deleteProp(prop.id);
    });

    return container;
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

    this.propMarkers.forEach((container) => {
      container.setAlpha(1);
      container.setSize(40, 40);
      container.setInteractive();
      this.input.setDraggable(container);
    });

    this.editDragHandler = (
      _pointer: Phaser.Input.Pointer,
      obj: Phaser.GameObjects.Container,
      dragX: number,
      dragY: number
    ) => {
      const { col, row } = pixelToTile(dragX, dragY);
      const snapped = tileToPixel(col, row);

      if (this.isTileOccupied(col, row, obj.getData("propId") as string)) return;

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
    this.propMarkers.forEach((container) => {
      container.setAlpha(0);
      this.input.setDraggable(container, false);
    });

    if (save) {
      // 현재 마커 위치로 새 config 구성
      const newProps: OfficeProp[] = [];
      this.propMarkers.forEach((container, propId) => {
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
      EventBus.emit("office:config-updated", newConfig);
    } else {
      // 취소: 저장된 위치로 복원
      if (this.preEditConfig) {
        this.currentConfig = this.preEditConfig;
        this.renderPropMarkers(this.preEditConfig);
      }
    }

    this.preEditConfig = null;
  }

  private isTileOccupied(col: number, row: number, excludeId: string): boolean {
    for (const [id, container] of this.propMarkers) {
      if (id === excludeId) continue;
      if (container.getData("tileCol") === col && container.getData("tileRow") === row) return true;
    }
    return false;
  }

  private deleteProp(propId: string) {
    const container = this.propMarkers.get(propId);
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
        // 흔들기 피드백
        this.tweens.add({
          targets: container,
          x: container.x + 6,
          duration: 50,
          yoyo: true,
          repeat: 3,
        });
        return;
      }
    }

    container.destroy();
    this.propMarkers.delete(propId);

    // currentConfig에서도 제거
    this.currentConfig = {
      props: this.currentConfig.props.filter((p) => p.id !== propId),
    };
  }

  private addProp(type: PropType) {
    if (!this.isEditMode) return;

    // 비어있는 타일 탐색
    let foundCol = -1, foundRow = -1;
    outer: for (let row = 0; row < TILE_GRID.rows; row++) {
      for (let col = 0; col < TILE_GRID.cols; col++) {
        if (!this.isTileOccupied(col, row, "")) {
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

    const marker = this.createPropMarker(newProp);
    marker.setAlpha(1);
    marker.setSize(40, 40);
    marker.setInteractive();
    this.input.setDraggable(marker);
    this.propMarkers.set(newId, marker);
  }

  // ── SPRITE 위치 동기화 ────────────────────────────────────────────────────

  private updateAllSpritePositions() {
    const { deskPositions, meetingSeats, loungeSeats } = this.getPropPositions();

    this.agents.forEach((sprite) => {
      const deskPos = deskPositions[sprite.deskIndex];
      sprite.updatePositionRefs(loungeSeats, meetingSeats, deskPos);
    });
  }

  // ── AGENT LIFECYCLE ─────────────────────────────────────────────────────────

  private spawnAgent(state: AgentState) {
    if (this.agents.has(state.agentId)) return;

    const { deskPositions, meetingSeats, loungeSeats } = this.getPropPositions();
    const deskPos =
      state.deskIndex != null && state.deskIndex >= 0 ? deskPositions[state.deskIndex] : undefined;

    const sprite = new AgentSprite({
      scene: this,
      agentId: state.agentId,
      name: state.name,
      initialStatus: state.state,
      loungeIndex: stableLoungeIndex(state.agentId, loungeSeats.length),
      loungeSeats,
      meetingSeats,
      deskPos,
      deskIndex: state.deskIndex,
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
    if (index !== -1) {
      this.meetingOccupied[index] = null;
    }
  }
}
