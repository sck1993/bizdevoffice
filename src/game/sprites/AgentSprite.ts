import * as Phaser from "phaser";
import { AgentStatus } from "../../types/agent";
import { LOUNGE_SEATS, MEETING_SEATS } from "../config";

interface AgentSpriteConfig {
  scene: Phaser.Scene;
  agentId: string;
  name: string;
  initialStatus: AgentStatus;
  loungeIndex: number; // 라운지 좌석 인덱스
  deskPos?: { x: number; y: number };
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
  private deskPos?: { x: number; y: number };

  constructor(config: AgentSpriteConfig) {
    const loungePos = LOUNGE_SEATS[config.loungeIndex] ?? LOUNGE_SEATS[0];
    super(config.scene, loungePos.x, loungePos.y, "character", 0);

    this.agentId = config.agentId;
    this.agentName = config.name;
    this.currentStatus = config.initialStatus;
    this.loungeIndex = config.loungeIndex;
    this.deskPos = config.deskPos;

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
    const text = this.taskTitle ?? this.currentStatus;
    this.tooltip.setText(text);
    this.tooltip.setVisible(true);
  }

  private hideTooltip() {
    this.tooltip.setVisible(false);
  }

  private getTargetPosition(state: AgentStatus): { x: number; y: number } {
    switch (state) {
      case "working": {
        return this.deskPos ?? LOUNGE_SEATS[this.loungeIndex] ?? { x: 130, y: 520 };
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

  setAgentName(name: string) {
    this.agentName = name;
    this.label.setText(name);
  }

  private moveToTarget() {
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
