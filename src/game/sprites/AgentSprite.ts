import * as Phaser from "phaser";
import { AgentStatus } from "../../types/agent";
import { DESK_POSITIONS, LOUNGE_SEATS, MEETING_SEATS } from "../config";

interface AgentSpriteConfig {
  scene: Phaser.Scene;
  agentId: string;
  name: string;
  initialStatus: AgentStatus;
  loungeIndex: number; // 라운지 좌석 인덱스
}

export class AgentSprite extends Phaser.GameObjects.Sprite {
  agentId: string;
  agentName: string;
  currentStatus: AgentStatus;
  private loungeIndex: number;
  private tooltip: Phaser.GameObjects.Text;
  private label: Phaser.GameObjects.Text;
  private meetingSeatIndex = -1;
  private taskTitle?: string;

  constructor(config: AgentSpriteConfig) {
    const loungePos = LOUNGE_SEATS[config.loungeIndex] ?? LOUNGE_SEATS[0];
    super(config.scene, loungePos.x, loungePos.y, "character", 0);

    this.agentId = config.agentId;
    this.agentName = config.name;
    this.currentStatus = config.initialStatus;
    this.loungeIndex = config.loungeIndex;

    config.scene.add.existing(this as unknown as Phaser.GameObjects.GameObject);
    this.setInteractive();

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
    if (!this.taskTitle) return;
    this.tooltip.setText(this.taskTitle);
    this.tooltip.setVisible(true);
  }

  private hideTooltip() {
    this.tooltip.setVisible(false);
  }

  private getTargetPosition(): { x: number; y: number } {
    switch (this.currentStatus) {
      case "working": {
        const desk = DESK_POSITIONS[this.agentId];
        return desk ?? LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
      }
      case "meeting": {
        return MEETING_SEATS[this.meetingSeatIndex] ?? LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
      }
      default:
        return LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
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

  private moveToTarget() {
    const target = this.getTargetPosition();
    this.scene.tweens.add({
      targets: [this, this.label, this.tooltip],
      x: target.x,
      y: target.y,
      duration: 1000,
      ease: "Power2",
      onUpdate: () => {
        this.label.setPosition(this.x, this.y - 50);
        this.tooltip.setPosition(this.x, this.y - 70);
      },
      onComplete: () => {
        this.playAnimation();
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
}
