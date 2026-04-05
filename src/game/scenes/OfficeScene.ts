import * as Phaser from "phaser";
import { EventBus } from "../EventBus";
import { DESK_SLOTS, GAME_HEIGHT, GAME_WIDTH, MEETING_SEATS } from "../config";
import { AgentSprite } from "../sprites/AgentSprite";
import type { AgentRemoved, AgentState, AgentStateChanged, AgentsSnapshot } from "../../types/agent";

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
    this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "background")
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    this.drawZones();
    this.registerAnimations();

    const handleSnapshot = (data: unknown) => {
      const { agents } = data as AgentsSnapshot;
      agents.forEach((agent, index) => {
        const existing = this.agents.get(agent.agentId);
        if (!existing) {
          this.spawnAgent(agent, index);
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

  private drawZones() {
    this.createZoneCard({
      x: 48,
      y: 92,
      width: 336,
      height: 256,
      fill: 0x17324a,
      stroke: 0x5db7ff,
      title: "Work Zone",
      subtitle: "Focus desks",
    });

    this.createZoneCard({
      x: 748,
      y: 118,
      width: 286,
      height: 190,
      fill: 0x203a30,
      stroke: 0x7ed4a3,
      title: "Meeting Zone",
      subtitle: "Shared discussion table",
    });

    this.createZoneCard({
      x: 44,
      y: 438,
      width: 700,
      height: 126,
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

    const panel = this.add.graphics();
    panel.fillStyle(config.fill, 0.18);
    panel.lineStyle(2, config.stroke, 0.9);
    panel.fillRoundedRect(config.x, config.y, config.width, config.height, 26);
    panel.strokeRoundedRect(config.x, config.y, config.width, config.height, 26);

    const chip = this.add.graphics();
    chip.fillStyle(config.stroke, 0.2);
    chip.lineStyle(1, config.stroke, 0.75);
    chip.fillRoundedRect(config.x + 18, config.y + 16, 118, 32, 16);
    chip.strokeRoundedRect(config.x + 18, config.y + 16, 118, 32, 16);

    this.add.text(config.x + 30, config.y + 24, config.title, {
      fontSize: "14px",
      fontStyle: "bold",
      color: "#eef7ff",
    });

    this.add.text(config.x + 20, config.y + 58, config.subtitle, {
      fontSize: "12px",
      color: "#d8e4f4",
    });
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
