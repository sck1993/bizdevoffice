import * as Phaser from "phaser";
import { AgentStatus } from "../../types/agent";

interface AgentSpriteConfig {
  scene: Phaser.Scene;
  agentId: string;
  name: string;
  initialStatus: AgentStatus;
  startPos?: { x: number; y: number };
  loungeIndex: number;
  loungeSeats: { x: number; y: number }[];
  meetingSeats: { x: number; y: number }[];
  deskPos?: { x: number; y: number };
  deskIndex?: number;
  imageUrl?: string | null;
  spriteFrames?: number;
}

// 라운지 존 배회 범위 (패딩 포함) — idle 상태에서만 사용
const LOUNGE_BOUNDS = { minX: 64, maxX: 560, minY: 415, maxY: 578 };
const SPEECH_BUBBLE = {
  minWidth: 96,
  maxWidth: 280,
  minHeight: 40,
  offsetY: -120,
  paddingX: 12,
  paddingY: 10,
  lineHeight: 12,
  fontSize: 10,
  fontFamily: "Arial, sans-serif",
  textColor: "#111111",
  cornerRadius: 10,
  tailHeight: 10,
};

type SpeechChar = {
  char: string;
  bold: boolean;
};

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
  private speechBubble: Phaser.GameObjects.Container | null = null;
  private speechBubbleBg: Phaser.GameObjects.Graphics | null = null;
  private speechBubbleHeight = SPEECH_BUBBLE.minHeight;
  private speechTextLayer: Phaser.GameObjects.Container | null = null;
  private speechBuffer = "";
  private speechThrottleHandle: ReturnType<typeof setTimeout> | null = null;
  private currentMoveTarget: { x: number; y: number } | null = null;
  private customImageUrl: string | null = null;
  private customFrameCount = 1;

  constructor(config: AgentSpriteConfig) {
    const loungePos = config.loungeSeats[config.loungeIndex] ?? config.loungeSeats[0] ?? { x: 130, y: 520 };
    const startPos = config.startPos ?? loungePos;
    super(config.scene, startPos.x, startPos.y, "character", 0);

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
    this.setDepth(10); // 소품(depth 4)보다 위에 렌더링

    // 커스텀 이미지 적용 (동적 로드)
    if (config.imageUrl) {
      this.loadCustomTexture(config.agentId, config.imageUrl, config.spriteFrames ?? 1);
    }

    // 이름 라벨
    this.label = config.scene.add.text(this.x, this.y - 50, config.name, {
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#00000088",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(11);

    // 툴팁 (기본 숨김)
    this.tooltip = config.scene.add.text(this.x, this.y - 70, "", {
      fontSize: "11px",
      color: "#ffffcc",
      backgroundColor: "#333333cc",
      padding: { x: 6, y: 3 },
      wordWrap: { width: 200 },
    }).setOrigin(0.5).setVisible(false).setDepth(12);

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
      case "meeting": {
        const seat = this.meetingSeats[this.meetingSeatIndex];
        if (seat) return seat;
        // meetingSeatIndex가 -1이거나 범위 초과 시 첫 번째 빈 좌석으로 폴백 (라운지 이동 방지)
        const fallbackSeat = this.meetingSeats[0];
        if (fallbackSeat) return fallbackSeat;
        return this.loungeSeats[this.loungeIndex] ?? { x: 130, y: 520 };
      }
      default:
        return this.loungeSeats[this.loungeIndex] ?? { x: 130, y: 520 };
    }
  }

  private faceToward(targetX: number) {
    const deltaX = targetX - this.x;
    if (deltaX > 1) {
      this.setFlipX(true);
    } else if (deltaX < -1) {
      this.setFlipX(false);
    }
  }

  setAgentState(
    status: AgentStatus,
    opts: { taskTitle?: string; meetingSeatIndex?: number } = {}
  ) {
    const nextMeetingSeatIndex =
      opts.meetingSeatIndex === undefined ? this.meetingSeatIndex : opts.meetingSeatIndex;
    const nextTaskTitle = opts.taskTitle;
    const fallbackMeetingSeat =
      status === "meeting" && nextMeetingSeatIndex === -1 ? this.meetingSeats[0] : undefined;
    const isAlreadyMovingToFallbackSeat = Boolean(
      fallbackMeetingSeat &&
      this.currentMoveTarget?.x === fallbackMeetingSeat.x &&
      this.currentMoveTarget?.y === fallbackMeetingSeat.y
    );
    const shouldForceMeetingFallbackMove = Boolean(
      fallbackMeetingSeat &&
      !isAlreadyMovingToFallbackSeat &&
      (this.x !== fallbackMeetingSeat.x || this.y !== fallbackMeetingSeat.y)
    );
    if (
      this.currentStatus === status &&
      this.taskTitle === nextTaskTitle &&
      this.meetingSeatIndex === nextMeetingSeatIndex &&
      !shouldForceMeetingFallbackMove
    ) {
      return;
    }

    this.currentStatus = status;
    this.taskTitle = nextTaskTitle;
    if (opts.meetingSeatIndex !== undefined) {
      this.meetingSeatIndex = opts.meetingSeatIndex;
    }
    this.hideTooltip();
    this.moveToTarget();
  }

  private applyCustomTexture(key: string, frames: number) {
    this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.setTexture(key);
    this.setDisplaySize(80, 80);

    if (frames > 1) {
      const animKey = `custom_anim_${key}`;
      if (!this.scene.anims.exists(animKey)) {
        this.scene.anims.create({
          key: animKey,
          frames: this.scene.anims.generateFrameNumbers(key, { start: 0, end: frames - 1 }),
          frameRate: 8,
          repeat: -1,
        });
      }
      const currentAnimKey = this.anims.currentAnim?.key;
      if (currentAnimKey !== animKey || !this.anims.isPlaying) {
        this.play(animKey, true);
      }
    } else {
      this.stop();
    }
  }

  private clearCustomAssets(removeTexture: boolean) {
    const key = `sprite_${this.agentId}`;
    const animKey = `custom_anim_${key}`;

    this.stop();
    if (this.scene.anims.exists(animKey)) {
      this.scene.anims.remove(animKey);
    }
    if (removeTexture && this.scene.textures.exists(key)) {
      this.scene.textures.remove(key);
    }
  }

  private resetToDefaultTexture() {
    this.clearCustomAssets(false);
    this.customImageUrl = null;
    this.customFrameCount = 1;
    this.setTexture("character", 0);
    this.setDisplaySize(96, 96);
    this.playAnimation();
  }

  private loadCustomTexture(agentId: string, imageUrl: string, frames = 1) {
    const key = `sprite_${agentId}`;
    this.customImageUrl = imageUrl;
    this.customFrameCount = frames;
    if (this.scene.textures.exists(key)) {
      this.applyCustomTexture(key, frames);
      return;
    }
    if (frames > 1) {
      this.scene.load.spritesheet(key, imageUrl, { frameWidth: 160, frameHeight: 160 });
    } else {
      this.scene.load.image(key, imageUrl);
    }
    const onComplete = () => {
      if (!this.scene || !this.active) return;
      if (this.scene.textures.exists(key)) {
        this.applyCustomTexture(key, frames);
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

  setAgentImage(imageUrl: string | null | undefined, frames?: number) {
    if (!imageUrl) {
      this.resetToDefaultTexture();
      return;
    }

    const nextFrames = frames && frames > 1 ? frames : 1;
    const key = `sprite_${this.agentId}`;
    const imageChanged = this.customImageUrl !== imageUrl;
    const framesChanged = this.customFrameCount !== nextFrames;

    if (!imageChanged && !framesChanged && this.scene.textures.exists(key) && this.texture.key === key) {
      return;
    }

    if ((imageChanged || framesChanged) && this.scene.textures.exists(key)) {
      this.clearCustomAssets(true);
    }

    this.loadCustomTexture(this.agentId, imageUrl, nextFrames);
  }

  updatePositionRefs(
    loungeSeats: { x: number; y: number }[],
    meetingSeats: { x: number; y: number }[],
    deskPos?: { x: number; y: number }
  ) {
    this.loungeSeats = loungeSeats;
    this.meetingSeats = meetingSeats;
    if (deskPos !== undefined) this.deskPos = deskPos;
    // 회의 중인 에이전트는 config 갱신으로 이동하지 않음 (meeting:turn이 위치를 관리)
    if (this.currentStatus !== "meeting") {
      this.moveToTarget();
    }
  }

  private stopWander() {
    if (this.wanderTimer) {
      this.wanderTimer.remove(false);
      this.wanderTimer = null;
    }
  }

  private scheduleWander() {
    if (!this.active || !this.scene?.time || this.currentStatus !== "idle") return;

    this.wanderTimer = this.scene.time.addEvent({
      delay: Phaser.Math.Between(2500, 6000),
      callback: () => {
        this.wanderTimer = null;
        if (!this.active || !this.scene?.tweens || this.currentStatus !== "idle") return;
        const b = LOUNGE_BOUNDS;
        const TILE = 80;

        // 현재 위치에서 ±1타일 범위 내 인접 이동, 존 경계 클램핑
        const tx = Phaser.Math.Clamp(
          this.x + Phaser.Math.Between(-1, 1) * TILE,
          b.minX, b.maxX,
        );
        const ty = Phaser.Math.Clamp(
          this.y + Phaser.Math.Between(-1, 1) * TILE,
          b.minY, b.maxY,
        );

        this.faceToward(tx);
        this.scene.tweens.add({
          targets: this,
          x: tx,
          y: ty,
          duration: Phaser.Math.Between(900, 2000),
          ease: "Sine.easeInOut",
          onUpdate: () => {
            if (!this.active) return;
            this.label.setPosition(this.x, this.y - 50);
            this.tooltip.setPosition(this.x, this.y - 70);
            this.updateBubblePosition();
          },
          onComplete: () => {
            if (!this.active) return;
            this.label.setPosition(this.x, this.y - 50);
            this.tooltip.setPosition(this.x, this.y - 70);
            this.updateBubblePosition();
            if (this.currentStatus === "idle") this.scheduleWander();
          },
        });
      },
    });
  }

  private moveToTarget() {
    if (!this.active || !this.scene?.tweens) return;
    this.stopWander();
    this.scene.tweens.killTweensOf(this);

    const target = this.getTargetPosition(this.currentStatus);
    this.currentMoveTarget = target;
    this.faceToward(target.x);
    this.scene.tweens.add({
      targets: this,
      x: target.x,
      y: target.y,
      duration: 1000,
      ease: "Power2",
      onUpdate: () => {
        if (!this.active) return;
        this.label.setPosition(this.x, this.y - 50);
        this.tooltip.setPosition(this.x, this.y - 70);
        this.updateBubblePosition();
      },
      onComplete: () => {
        if (!this.active) return;
        this.currentMoveTarget = null;
        this.label.setPosition(this.x, this.y - 50);
        this.tooltip.setPosition(this.x, this.y - 70);
        this.updateBubblePosition();
        this.playAnimation();
        this.scheduleWander();
      },
    });
  }

  private playAnimation() {
    if (this.customImageUrl) return;
    const animKey = `agent_${this.currentStatus}`;
    if (this.anims.exists(animKey)) {
      this.play(animKey, true);
    }
  }

  // ── 말풍선 ──────────────────────────────────────────────────────────────────

  showSpeechBubble() {
    this.hideSpeechBubble();
    this.speechBuffer = "";
    const { offsetY } = SPEECH_BUBBLE;

    const bg = this.scene.add.graphics();
    this.speechBubbleBg = bg;
    this.speechBubbleHeight = SPEECH_BUBBLE.minHeight;
    this.speechTextLayer = this.scene.add.container(0, 0);
    this.speechBubble = this.scene.add.container(this.x, this.y + offsetY, [bg, this.speechTextLayer]);
    this.speechBubble.setDepth(15);
    this.renderSpeechText("...");
  }

  appendSpeechChunk(chunk: string) {
    this.speechBuffer += chunk;

    if (this.speechThrottleHandle !== null) return;
    this.speechThrottleHandle = setTimeout(() => {
      this.speechThrottleHandle = null;
      if (this.speechTextLayer && this.speechBubble) {
        const preview = this.speechBuffer.slice(-180);
        this.renderSpeechText(preview);
      }
    }, 100);
  }

  hideSpeechBubble() {
    if (this.speechThrottleHandle !== null) {
      clearTimeout(this.speechThrottleHandle);
      this.speechThrottleHandle = null;
    }
    this.speechBubble?.destroy();
    this.speechBubble = null;
    this.speechBubbleBg = null;
    this.speechBubbleHeight = SPEECH_BUBBLE.minHeight;
    this.speechTextLayer = null;
    this.speechBuffer = "";
  }

  private parseSpeechChars(text: string): SpeechChar[] {
    const chars: SpeechChar[] = [];
    let index = 0;
    let bold = false;

    while (index < text.length) {
      if (text.startsWith("**", index)) {
        bold = !bold;
        index += 2;
        continue;
      }

      const codePoint = text.codePointAt(index);
      if (codePoint === undefined) break;
      const char = String.fromCodePoint(codePoint);
      chars.push({ char, bold });
      index += char.length;
    }

    return chars;
  }

  private measureSpeechText(text: string, bold: boolean) {
    const context = this.scene.sys.game.canvas.getContext("2d");
    if (!context) {
      return Math.max(5, text.length * 6);
    }

    context.save();
    context.font = `${bold ? "bold " : ""}${SPEECH_BUBBLE.fontSize}px ${SPEECH_BUBBLE.fontFamily}`;
    const width = context.measureText(text).width;
    context.restore();
    return width;
  }

  private wrapSpeechText(text: string) {
    const maxWidth = SPEECH_BUBBLE.maxWidth - SPEECH_BUBBLE.paddingX * 2;
    const lines: SpeechChar[][] = [[]];
    let lineWidth = 0;

    for (const item of this.parseSpeechChars(text)) {
      if (item.char === "\n") {
        lines.push([]);
        lineWidth = 0;
        continue;
      }

      const charWidth = this.measureSpeechText(item.char, item.bold);
      if (lineWidth + charWidth > maxWidth && lines[lines.length - 1].length > 0) {
        lines.push([]);
        lineWidth = 0;
      }

      lines[lines.length - 1].push(item);
      lineWidth += charWidth;
    }

    return lines;
  }

  private renderSpeechText(text: string) {
    if (!this.speechTextLayer || !this.speechBubbleBg) return;

    this.speechTextLayer.removeAll(true);
    const lines = this.wrapSpeechText(text);
    const lineWidths = lines.map((line) =>
      line.reduce((sum, item) => sum + this.measureSpeechText(item.char, item.bold), 0),
    );
    const contentWidth = lineWidths.reduce((max, width) => Math.max(max, width), 0);
    const bubbleWidth = Phaser.Math.Clamp(
      Math.ceil(contentWidth + SPEECH_BUBBLE.paddingX * 2),
      SPEECH_BUBBLE.minWidth,
      SPEECH_BUBBLE.maxWidth,
    );
    const contentHeight = Math.max(SPEECH_BUBBLE.lineHeight, lines.length * SPEECH_BUBBLE.lineHeight);
    const bubbleHeight = Math.max(
      SPEECH_BUBBLE.minHeight,
      Math.ceil(contentHeight + SPEECH_BUBBLE.paddingY * 2),
    );

    this.speechBubbleHeight = bubbleHeight;
    this.speechBubbleBg.clear();
    this.speechBubbleBg.fillStyle(0xffffff, 0.95);
    this.speechBubbleBg.fillRoundedRect(
      -bubbleWidth / 2,
      -bubbleHeight / 2,
      bubbleWidth,
      bubbleHeight,
      SPEECH_BUBBLE.cornerRadius,
    );
    this.speechBubbleBg.fillStyle(0xdddddd, 0.95);
    this.speechBubbleBg.fillTriangle(
      -8,
      bubbleHeight / 2,
      8,
      bubbleHeight / 2,
      0,
      bubbleHeight / 2 + SPEECH_BUBBLE.tailHeight,
    );
    this.speechTextLayer.setPosition(
      -bubbleWidth / 2 + SPEECH_BUBBLE.paddingX,
      -bubbleHeight / 2 + SPEECH_BUBBLE.paddingY,
    );

    lines.forEach((line, lineIndex) => {
      let x = 0;
      let buffer = "";
      let currentBold = line[0]?.bold ?? false;

      const flush = () => {
        if (!buffer) return;
        const textObject = this.scene.add.text(x, lineIndex * SPEECH_BUBBLE.lineHeight, buffer, {
          fontSize: `${SPEECH_BUBBLE.fontSize}px`,
          fontFamily: SPEECH_BUBBLE.fontFamily,
          fontStyle: currentBold ? "bold" : "normal",
          color: SPEECH_BUBBLE.textColor,
          align: "left",
        }).setOrigin(0, 0);
        this.speechTextLayer?.add(textObject);
        x += this.measureSpeechText(buffer, currentBold);
        buffer = "";
      };

      for (const item of line) {
        if (item.bold !== currentBold) {
          flush();
          currentBold = item.bold;
        }
        buffer += item.char;
      }
      flush();
    });
  }

  private updateBubblePosition() {
    if (this.speechBubble) {
      const verticalAdjust = (this.speechBubbleHeight - SPEECH_BUBBLE.minHeight) / 2;
      this.speechBubble.setPosition(this.x, this.y + SPEECH_BUBBLE.offsetY - verticalAdjust);
    }
  }

  dim(active: boolean) {
    this.setAlpha(active ? 0.4 : 1.0);
    this.label.setAlpha(active ? 0.4 : 1.0);
    this.speechBubble?.setAlpha(active ? 0.4 : 1.0);
  }

  override destroy(fromScene?: boolean) {
    this.stopWander();
    this.scene?.tweens?.killTweensOf(this);
    this.hideSpeechBubble();
    this.clearCustomAssets(false);
    this.label.destroy();
    this.tooltip.destroy();
    super.destroy(fromScene);
  }
}
