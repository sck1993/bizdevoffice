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

    this.registerAnimations();

    const handleSnapshot = (data: unknown) => {
      const { agents } = data as AgentsSnapshot;
      agents.forEach((agent, index) => {
        const existing = this.agents.get(agent.agentId);
        if (!existing) {
          this.spawnAgent(agent, index);
          return;
        }

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
