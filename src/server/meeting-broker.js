"use strict";

const { agentStateStore } = require("./agent-state-store");

// ─── 타임아웃 상수 ────────────────────────────────────────────────────────────
const POLL_TIMEOUT_MS = 15_000;   // 폴링 응답 대기 (초과 시 PASS)
const SPEAK_TIMEOUT_MS = 60_000;  // 발언 스트리밍 완료 대기
const TOTAL_MEETING_TIMEOUT_MS = 600_000; // 전체 회의 하드 타임아웃 (10분)

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ─── MeetingBroker ────────────────────────────────────────────────────────────
class MeetingBroker {
  /**
   * @param {{
   *   meetingId: string,
   *   topic: string,
   *   participants: Array<{agentId: string, name: string}>,
   *   gateway: object,
   *   io: object,
   *   opts?: { maxTurns?: number, maxConsecutivePasses?: number }
   * }} config
   */
  constructor({ meetingId, topic, participants, gateway, io, opts = {} }) {
    this.meetingId = meetingId;
    this.topic = topic;
    this.participants = participants;
    this.gateway = gateway;
    this.io = io;

    this.maxTurns = opts.maxTurns ?? 20;
    this.maxConsecutivePasses = opts.maxConsecutivePasses ?? 3;

    /** @type {Array<{agentId:string, name:string, content:string, timestamp:number}>} */
    this.turns = [];
    /** @type {Map<string, number>} agentId → 마지막 발언 timestamp */
    this.lastSpoke = new Map();

    this.running = false;
    this.consecutivePasses = 0;
    this._pollTurnNum = 0;
    this._totalTimeoutHandle = null;
  }

  // ── 메인 루프 ──────────────────────────────────────────────────────────────
  async run() {
    this.running = true;

    // 전체 회의 하드 타임아웃
    this._totalTimeoutHandle = setTimeout(() => {
      console.warn(`[meeting] ${this.meetingId} 전체 시간 초과(10분) → 강제 종료`);
      this.stop();
    }, TOTAL_MEETING_TIMEOUT_MS);

    // 참가 에이전트 meeting 상태로 전환
    for (const p of this.participants) {
      agentStateStore.updateStatus(p.agentId, "meeting");
      this.io.emit("agent:state-changed", { agentId: p.agentId, state: "meeting" });
    }

    try {
      while (this.running && this.turns.length < this.maxTurns) {
        this._pollTurnNum++;
        const { raises } = await this.pollAgents();

        if (raises.length === 0) {
          this.consecutivePasses++;
          console.log(`[meeting] ${this.meetingId} 연속 PASS ${this.consecutivePasses}/${this.maxConsecutivePasses}`);
          if (this.consecutivePasses >= this.maxConsecutivePasses) break;
          continue;
        }
        this.consecutivePasses = 0;

        const speaker = this.selectSpeaker(raises);
        console.log(`[meeting] ${this.meetingId} 발언자 선택: ${speaker.name}`);

        this.io.emit("meeting:turn-start", { agentId: speaker.agentId, name: speaker.name });
        const response = await this.speakAgent(speaker);

        if (response) {
          this.addTurn(speaker.agentId, speaker.name, response);
          this.io.emit("meeting:turn-end", { agentId: speaker.agentId, name: speaker.name, content: response });
        }
      }
    } catch (err) {
      console.error(`[meeting] ${this.meetingId} 오류:`, err);
      this.io.emit("meeting:error", { error: err.message });
    } finally {
      this._cleanup();
    }
  }

  stop() {
    this.running = false;
    // 하드 타임아웃 타이머도 즉시 해제
    if (this._totalTimeoutHandle) {
      clearTimeout(this._totalTimeoutHandle);
      this._totalTimeoutHandle = null;
    }
  }

  // ── 폴링 ──────────────────────────────────────────────────────────────────
  async pollAgents() {
    const recentTurns = this.turns.slice(-3);
    const pollPrompt = this._buildPollPrompt(recentTurns);

    const results = await Promise.all(
      this.participants.map((p) => this._pollOne(p, pollPrompt))
    );

    const raises = results.filter((r) => r.wants === "SPEAK");
    const passes = results.filter((r) => r.wants === "PASS");
    console.log(`[meeting] poll 결과 — SPEAK: ${raises.map((r) => r.name).join(", ") || "없음"} | PASS: ${passes.map((r) => r.name).join(", ")}`);

    return { raises, passes };
  }

  async _pollOne(participant, prompt) {
    const sessionKey = `meeting:${this.meetingId}:poll:${this._pollTurnNum}:${participant.agentId}`;
    let response = "";

    try {
      await withTimeout(
        this.gateway.chatSend(participant.agentId, sessionKey, prompt, (chunk) => {
          response += chunk;
        }),
        POLL_TIMEOUT_MS,
        null,
      );
    } catch (err) {
      console.warn(`[meeting] poll 오류 (${participant.name}):`, err.message);
    }

    const wants = response.trimStart().toUpperCase().startsWith("SPEAK") ? "SPEAK" : "PASS";
    return { ...participant, wants };
  }

  // ── 발언 ──────────────────────────────────────────────────────────────────
  async speakAgent(participant) {
    const sessionKey = `meeting:${this.meetingId}:speak:${participant.agentId}`;
    const prompt = this._buildSpeakPrompt();
    let response = "";

    try {
      await withTimeout(
        this.gateway.chatSend(participant.agentId, sessionKey, prompt, (chunk) => {
          if (!this.running) return; // stop() 후 누출 차단
          response += chunk;
          this.io.emit("meeting:speech-chunk", { agentId: participant.agentId, chunk });
        }),
        SPEAK_TIMEOUT_MS,
        null,
      );
    } catch (err) {
      console.warn(`[meeting] speak 오류 (${participant.name}):`, err.message);
    }

    return response.trim() || null;
  }

  // ── 발언자 선택 ─────────────────────────────────────────────────────────
  selectSpeaker(raises) {
    let selected = raises[0];
    let oldestTime = this.lastSpoke.get(selected.agentId) ?? 0;

    for (const r of raises) {
      const t = this.lastSpoke.get(r.agentId) ?? 0;
      if (t < oldestTime) {
        oldestTime = t;
        selected = r;
      }
    }

    this.lastSpoke.set(selected.agentId, Date.now());
    return selected;
  }

  // ── 내부 유틸 ─────────────────────────────────────────────────────────────
  addTurn(agentId, name, content) {
    this.turns.push({ agentId, name, content, timestamp: Date.now() });
  }

  _buildPollPrompt(recentTurns) {
    const contextLines = recentTurns.length > 0
      ? recentTurns.map((t) => `${t.name}: ${t.content}`).join("\n")
      : "(아직 발언 없음)";

    return [
      `[회의 주제] ${this.topic}`,
      "",
      `[최근 대화]`,
      contextLines,
      "",
      "위 회의에서 당신이 추가로 발언하고 싶다면 첫 줄에 'SPEAK', 발언하지 않을 것이면 'PASS'만 답하세요.",
    ].join("\n");
  }

  _buildSpeakPrompt() {
    const transcriptLines = this.turns.length > 0
      ? this.turns.map((t) => `${t.name}: ${t.content}`).join("\n")
      : "(첫 번째 발언입니다)";

    return [
      `[회의 주제] ${this.topic}`,
      "",
      `[지금까지 대화]`,
      transcriptLines,
      "",
      "위 회의에서 당신의 다음 발언을 간결하게 해주세요.",
    ].join("\n");
  }

  _cleanup() {
    if (this._totalTimeoutHandle) {
      clearTimeout(this._totalTimeoutHandle);
      this._totalTimeoutHandle = null;
    }

    // 참가 에이전트 idle 복원
    for (const p of this.participants) {
      agentStateStore.updateStatus(p.agentId, "idle");
      this.io.emit("agent:state-changed", { agentId: p.agentId, state: "idle" });
    }

    this.io.emit("meeting:ended", { turns: this.turns });
    console.log(`[meeting] ${this.meetingId} 종료 (총 ${this.turns.length}턴)`);
  }
}

module.exports = { MeetingBroker };
