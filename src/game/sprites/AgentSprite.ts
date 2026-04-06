import * as Phaser from "phaser";
import { AgentStatus } from "../../types/agent";

interface AgentSpriteConfig {
  scene: Phaser.Scene;
  agentId: string;
  name: string;
  initialStatus: AgentStatus;
  loungeIndex: number;
  loungeSeats: { x: number; y: number }[];
  meetingSeats: { x: number; y: number }[];
  deskPos?: { x: number; y: number };
  deskIndex?: number;
  imageUrl?: string | null;
}

// 라운지 존 배회 범위 (패딩 포함) — idle 상태에서만 사용
const LOUNGE_BOUNDS = { minX: 64, maxX: 560, minY: 415, maxY: 578 };

export class AgentSprite extends Phaser.GameObjects.Sprite {
  agentId: string;
  agentName: string;
  currentStatus: AgentStatus;
  deskIndex: number;
  private loungeIndex: number;
  private loungeSeats: { x: number; y: number }[];
  private meetingSeats: { x: number; y: number }[];
  private tooltip: Phaser.GameObjects.Text;
  private label: Phaser.GameObjects.Text;
  private meetingSeatIndex = -1;
  private taskTitle?: string;
  private deskPos?: { x: number; y: number };
  private wanderTimer: Phaser.Time.TimerEvent | null = null;

  constructor(config: AgentSpriteConfig) {
    const loungePos = config.loungeSeats[config.loungeIndex] ?? config.loungeSeats[0] ?? { x: 130, y: 520 };
    super(config.scene, loungePos.x, loungePos.y, "character", 0);

    this.agentId = config.agentId;
    this.agentName = config.name;
    this.currentStatus = config.initialStatus;
    this.loungeIndex = config.loungeIndex;
    this.loungeSeats = config.loungeSeats;
    this.meetingSeats = config.meetingSeats;
    this.deskPos = config.deskPos;
    this.deskIndex = config.deskIndex ?? -1;

    config.scene.add.existing(this as unknown as Phaser.GameObjects.GameObject);
    this.setInteractive();

    // 커스텀 이미지 적용 (동적 로드)
    if (config.imageUrl) {
      this.loadCustomTexture(config.agentId, config.imageUrl);
    }

    // 이름 라벨
    this.label = config.scene.add.text(this.x, this.y - 50, config.name, {
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#00000088",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5);

    // 툴팁 (기본 숨김)
    this.tooltip = config.scene.add.text(this.x, this.y - 70, "", {
      fontSize: "11px",
      color: "#ffffcc",
      backgroundColor: "#333333cc",
      padding: { x: 6, y: 3 },
      wordWrap: { width: 200 },
    }).setOrigin(0.5).setVisible(false);

    this.on("pointerdown", () => this.showTooltip());
    config.scene.input.on("pointerdown", (_: unknown, gameObjects: Phaser.GameObjects.GameObject[]) => {
      if (!gameObjects.includes(this as unknown as Phaser.GameObjects.GameObject)) this.hideTooltip();
    });
  }

  private showTooltip() {
    const text = this.taskTitle ?? this.currentStatus;
    this.tooltip.setText(text);
    this.tooltip.setVisible(true);
  }

  private hideTooltip() {
    this.tooltip.setVisible(false);
  }

  private getTargetPosition(state: AgentStatus): { x: number; y: number } {
    switch (state) {
      case "working":
        return this.deskPos ?? this.loungeSeats[this.loungeIndex] ?? { x: 130, y: 520 };
      case "meeting":
        return this.meetingSeats[this.meetingSeatIndex] ?? this.loungeSeats[this.loungeIndex] ?? { x: 130, y: 520 };
      default:
        return this.loungeSeats[this.loungeIndex] ?? { x: 130, y: 520 };
    }
  }

  setAgentState(
    status: AgentStatus,
    opts: { taskTitle?: string; meetingSeatIndex?: number } = {}
  ) {
    this.currentStatus = status;
    this.taskTitle = opts.taskTitle;
    if (opts.meetingSeatIndex !== undefined) {
      this.meetingSeatIndex = opts.meetingSeatIndex;
    }
    this.hideTooltip();
    this.moveToTarget();
  }

  private loadCustomTexture(agentId: string, imageUrl: string) {
    const key = `sprite_${agentId}`;
    if (this.scene.textures.exists(key)) {
      this.setTexture(key);
      this.setDisplaySize(80, 80);
      return;
    }
    this.scene.load.image(key, imageUrl);
    const onComplete = () => {
      if (!this.scene || !this.active) return;
      if (this.scene.textures.exists(key)) {
        this.setTexture(key);
        this.setDisplaySize(80, 80);
      } else {
        // 이 배치에 포함되지 않은 경우 — 다음 COMPLETE에서 재시도
        this.scene.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
      }
    };
    this.scene.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
    this.scene.load.start();
  }

  setAgentName(name: string) {
    this.agentName = name;
    this.label.setText(name);
  }

  setAgentImage(imageUrl: string | null | undefined) {
    if (!imageUrl) return;
    this.loadCustomTexture(this.agentId, imageUrl);
  }

  updatePositionRefs(
    loungeSeats: { x: number; y: number }[],
    meetingSeats: { x: number; y: number }[],
    deskPos?: { x: number; y: number }
  ) {
    this.loungeSeats = loungeSeats;
    this.meetingSeats = meetingSeats;
    if (deskPos !== undefined) this.deskPos = deskPos;
    this.moveToTarget();
  }

  private stopWander() {
    if (this.wanderTimer) {
      this.wanderTimer.remove(false);
      this.wanderTimer = null;
    }
  }

  private scheduleWander() {
    if (this.currentStatus !== "idle") return;

    this.wanderTimer = this.scene.time.addEvent({
      delay: Phaser.Math.Between(2500, 6000),
      callback: () => {
        this.wanderTimer = null;
        if (this.currentStatus !== "idle") return;
        const b = LOUNGE_BOUNDS;

        const tx = Phaser.Math.Between(b.minX, b.maxX);
        const ty = Phaser.Math.Between(b.minY, b.maxY);

        this.scene.tweens.add({
          targets: this,
          x: tx,
          y: ty,
          duration: Phaser.Math.Between(900, 2000),
          ease: "Sine.easeInOut",
          onUpdate: () => {
            this.label.setPosition(this.x, this.y - 50);
            this.tooltip.setPosition(this.x, this.y - 70);
          },
          onComplete: () => {
            this.label.setPosition(this.x, this.y - 50);
            this.tooltip.setPosition(this.x, this.y - 70);
            if (this.currentStatus === "idle") this.scheduleWander();
          },
        });
      },
    });
  }

  private moveToTarget() {
    this.stopWander();
    this.scene.tweens.killTweensOf(this);

    const target = this.getTargetPosition(this.currentStatus);
    this.scene.tweens.add({
      targets: this,
      x: target.x,
      y: target.y,
      duration: 1000,
      ease: "Power2",
      onUpdate: () => {
        this.label.setPosition(this.x, this.y - 50);
        this.tooltip.setPosition(this.x, this.y - 70);
      },
      onComplete: () => {
        this.label.setPosition(this.x, this.y - 50);
        this.tooltip.setPosition(this.x, this.y - 70);
        this.playAnimation();
        this.scheduleWander();
      },
    });
  }

  private playAnimation() {
    const animKey = `agent_${this.currentStatus}`;
    if (this.anims.exists(animKey)) {
      this.play(animKey, true);
    }
  }

  dim(active: boolean) {
    this.setAlpha(active ? 0.4 : 1.0);
    this.label.setAlpha(active ? 0.4 : 1.0);
  }

  override destroy(fromScene?: boolean) {
    this.stopWander();
    this.label.destroy();
    this.tooltip.destroy();
    super.destroy(fromScene);
  }
}
