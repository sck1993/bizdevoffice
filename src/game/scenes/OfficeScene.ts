import * as Phaser from "phaser";
import { EventBus } from "../EventBus";
import { DESK_SLOTS, GAME_HEIGHT, GAME_WIDTH, MEETING_SEATS } from "../config";
import { AgentSprite } from "../sprites/AgentSprite";
import type { AgentRemoved, AgentState, AgentStateChanged, AgentsSnapshot } from "../../types/agent";

function stableLoungeIndex(agentId: string): number {
  return agentId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 5;
}

export class OfficeScene extends Phaser.Scene {
  private agents = new Map<string, AgentSprite>();
  private meetingOccupied: (string | null)[] = MEETING_SEATS.map(() => null);

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

    const handleSnapshot = (data: unknown) => {
      const { agents } = data as AgentsSnapshot;
      agents.forEach((agent, index) => {
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

        existing.setAgentState(agent.state, {
          taskTitle: agent.taskTitle,
          meetingSeatIndex,
        });
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

    EventBus.on("agents:snapshot", handleSnapshot);
    EventBus.on("agent:state-changed", handleStateChanged);
    EventBus.on("agent:removed", handleAgentRemoved);
    EventBus.on("connection:lost", handleConnectionLost);
    EventBus.on("connection:restored", handleConnectionRestored);

    this.events.once("shutdown", () => {
      EventBus.off("agents:snapshot", handleSnapshot);
      EventBus.off("agent:state-changed", handleStateChanged);
      EventBus.off("agent:removed", handleAgentRemoved);
      EventBus.off("connection:lost", handleConnectionLost);
      EventBus.off("connection:restored", handleConnectionRestored);
    });
  }

  private drawBackdrop() {
    this.cameras.main.setBackgroundColor("#111827");

    const frame = this.add.graphics();
    frame.fillStyle(0x162033, 1);
    frame.fillRoundedRect(24, 22, GAME_WIDTH - 48, GAME_HEIGHT - 44, 24);

    const wall = this.add.graphics();
    wall.fillStyle(0xf4ede4, 1);
    wall.fillRoundedRect(40, 22, GAME_WIDTH - 80, 180, 22);

    const floor = this.add.graphics();
    floor.fillStyle(0xe4b56d, 1);
    floor.fillRoundedRect(40, 150, GAME_WIDTH - 80, GAME_HEIGHT - 172, 0);

    const floorLines = this.add.graphics();
    floorLines.lineStyle(2, 0xf0c989, 0.18);
    for (let y = 172; y < GAME_HEIGHT - 30; y += 28) {
      floorLines.lineBetween(48, y, GAME_WIDTH - 48, y);
    }

    const floorSeams = this.add.graphics();
    floorSeams.lineStyle(1, 0xc7864c, 0.2);
    for (let x = 74; x < GAME_WIDTH - 40; x += 96) {
      floorSeams.lineBetween(x, 154, x, GAME_HEIGHT - 24);
    }

    const northGlass = this.add.graphics();
    northGlass.fillStyle(0xaed2f5, 0.18);
    northGlass.lineStyle(2, 0xd9edf9, 0.4);
    northGlass.fillRoundedRect(648, 48, 368, 88, 18);
    northGlass.strokeRoundedRect(648, 48, 368, 88, 18);

    const leftGlass = this.add.graphics();
    leftGlass.fillStyle(0xb9d7f3, 0.1);
    leftGlass.lineStyle(2, 0xcfe5f8, 0.3);
    leftGlass.fillRoundedRect(40, 92, 126, 292, 18);
    leftGlass.strokeRoundedRect(40, 92, 126, 292, 18);

    const rightGlass = this.add.graphics();
    rightGlass.fillStyle(0xb9d7f3, 0.08);
    rightGlass.lineStyle(2, 0xcfe5f8, 0.22);
    rightGlass.fillRoundedRect(1098, 86, 142, 340, 18);
    rightGlass.strokeRoundedRect(1098, 86, 142, 340, 18);

    const centerGlow = this.add.graphics();
    centerGlow.fillStyle(0xffffff, 0.06);
    centerGlow.fillEllipse(642, 338, 520, 256);

    const loungeGuide = this.add.graphics();
    loungeGuide.fillStyle(0x3d2d1e, 0.1);
    loungeGuide.fillRoundedRect(52, 430, 690, 136, 28);
  }

  private drawZones() {
    this.createZoneCard({
      x: 48,
      y: 102,
      width: 336,
      height: 246,
      fill: 0x17324a,
      stroke: 0x5db7ff,
      title: "Work Zone",
      subtitle: "Focus desks",
    });

    this.createZoneCard({
      x: 748,
      y: 128,
      width: 286,
      height: 182,
      fill: 0x203a30,
      stroke: 0x7ed4a3,
      title: "Meeting Zone",
      subtitle: "Shared discussion table",
    });

    this.createZoneCard({
      x: 44,
      y: 438,
      width: 700,
      height: 128,
      fill: 0x43311f,
      stroke: 0xffb16e,
      title: "Lounge Zone",
      subtitle: "Idle and waiting area",
    });
  }

  private createZoneCard(config: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: number;
    stroke: number;
    title: string;
    subtitle: string;
  }) {
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.14);
    shadow.fillRoundedRect(config.x + 8, config.y + 12, config.width, config.height, 26);
    shadow.setDepth(1);

    const panel = this.add.graphics();
    panel.fillStyle(config.fill, 0.12);
    panel.lineStyle(2, config.stroke, 0.72);
    panel.fillRoundedRect(config.x, config.y, config.width, config.height, 26);
    panel.strokeRoundedRect(config.x, config.y, config.width, config.height, 26);
    panel.setDepth(2);

    const titleText = this.add.text(config.x + 30, config.y + 24, config.title, {
      fontSize: "14px",
      fontStyle: "bold",
      color: "#eef7ff",
    });
    titleText.setDepth(4);

    const chip = this.add.graphics();
    chip.fillStyle(config.stroke, 0.2);
    chip.lineStyle(1, config.stroke, 0.65);
    chip.fillRoundedRect(config.x + 18, config.y + 16, Math.max(132, titleText.width + 28), 32, 16);
    chip.strokeRoundedRect(config.x + 18, config.y + 16, Math.max(132, titleText.width + 28), 32, 16);
    chip.setDepth(3);

    const subtitleText = this.add.text(config.x + 20, config.y + 58, config.subtitle, {
      fontSize: "12px",
      color: "#d8e4f4",
    });
    subtitleText.setDepth(4);
  }

  private registerAnimations() {
    const texture = this.textures.get("character");
    const numericFrames = texture
      .getFrameNames()
      .filter((name) => name !== "__BASE")
      .map((name) => Number(name))
      .filter((name) => Number.isFinite(name))
      .sort((a, b) => a - b);

    const fallbackFrame = numericFrames[0] ?? 0;

    this.createAnimation("agent_idle", numericFrames.filter((frame) => frame >= 0 && frame <= 3), fallbackFrame, 6);
    this.createAnimation(
      "agent_working",
      numericFrames.filter((frame) => frame >= 4 && frame <= 7),
      fallbackFrame,
      8
    );
    this.createAnimation(
      "agent_meeting",
      numericFrames.filter((frame) => frame >= 8 && frame <= 11),
      fallbackFrame,
      6
    );
  }

  private createAnimation(key: string, frames: number[], fallbackFrame: number, frameRate: number) {
    if (this.anims.exists(key)) return;

    const safeFrames = (frames.length > 0 ? frames : [fallbackFrame]).map((frame) => ({
      key: "character",
      frame,
    }));

    this.anims.create({
      key,
      frames: safeFrames,
      frameRate,
      repeat: -1,
    });
  }

  private spawnAgent(state: AgentState) {
    if (this.agents.has(state.agentId)) return;

    const deskPos = state.deskIndex != null && state.deskIndex >= 0
      ? DESK_SLOTS[state.deskIndex]
      : undefined;

    const sprite = new AgentSprite({
      scene: this,
      agentId: state.agentId,
      name: state.name,
      initialStatus: state.state,
      loungeIndex: stableLoungeIndex(state.agentId),
      deskPos,
    });

    this.agents.set(state.agentId, sprite);

    const meetingSeatIndex = state.state === "meeting" ? this.claimMeetingSeat(state.agentId) : -1;
    sprite.setAgentState(state.state, {
      taskTitle: state.taskTitle,
      meetingSeatIndex,
    });
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
