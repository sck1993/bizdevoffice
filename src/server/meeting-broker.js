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

    this.maxTurns = opts.maxTurns ?? 12;
    this.minTurns = opts.minTurns ?? 4;
    this.maxConsecutivePasses = opts.maxConsecutivePasses ?? 2;

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
      if (this.running && this.turns.length === 0) {
        const opened = await this._runOpeningTurn();
        if (!opened) {
          console.warn(`[meeting] ${this.meetingId} 시작 발언 생성 실패`);
        }
      }

      while (this.running && this.turns.length < this.maxTurns) {
        this._pollTurnNum++;
        const { raises } = await this.pollAgents();

        if (raises.length === 0) {
          if (this.turns.length < this.minTurns) {
            const fallbackSpeaker = this.selectSpeaker(this.participants);
            console.log(
              `[meeting] ${this.meetingId} 전원 PASS이지만 최소 턴(${this.minTurns}) 미달 → ${fallbackSpeaker.name} 강제 발언`,
            );
            this.io.emit("meeting:turn-start", {
              agentId: fallbackSpeaker.agentId,
              name: fallbackSpeaker.name,
            });
            const fallbackResponse = await this.speakAgent(fallbackSpeaker);
            if (!fallbackResponse) {
              this.io.emit("meeting:turn-end", {
                agentId: fallbackSpeaker.agentId,
                name: fallbackSpeaker.name,
                content: "",
              });
              break;
            }
            this.addTurn(fallbackSpeaker.agentId, fallbackSpeaker.name, fallbackResponse);
            this.io.emit("meeting:turn-end", {
              agentId: fallbackSpeaker.agentId,
              name: fallbackSpeaker.name,
              content: fallbackResponse,
            });
            this.consecutivePasses = 0;
            continue;
          }
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
        }, participant.model),
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
        }, participant.model),
        SPEAK_TIMEOUT_MS,
        null,
      );
    } catch (err) {
      console.warn(`[meeting] speak 오류 (${participant.name}):`, err.message);
    }

    return response.trim() || null;
  }

  async _runOpeningTurn() {
    for (const participant of this.participants) {
      if (!this.running) return false;

      console.log(`[meeting] ${this.meetingId} 시작 발언자 시도: ${participant.name}`);
      this.io.emit("meeting:turn-start", { agentId: participant.agentId, name: participant.name });
      const response = await this.speakAgent(participant);

      if (!response) {
        this.io.emit("meeting:turn-end", {
          agentId: participant.agentId,
          name: participant.name,
          content: "",
        });
        continue;
      }

      this.addTurn(participant.agentId, participant.name, response);
      this.lastSpoke.set(participant.agentId, Date.now());
      this.io.emit("meeting:turn-end", {
        agentId: participant.agentId,
        name: participant.name,
        content: response,
      });
      return true;
    }

    return false;
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

    const turnNote = this.turns.length < this.minTurns
      ? `(현재 ${this.turns.length}턴 — 아직 논의가 충분히 이루어지지 않았습니다)`
      : `(현재 ${this.turns.length}턴)`;

    return [
      `[회의 주제] ${this.topic}`,
      "",
      `[최근 대화] ${turnNote}`,
      contextLines,
      "",
      "아래 기준에 따라 첫 줄에 'SPEAK' 또는 'PASS'만 답하세요.",
      "- 반론, 보완 의견, 구체적 질문, 다른 관점이 있으면 SPEAK",
      "- 상대 발언에 단순 동의만 하거나 정말 보탤 말이 없을 때만 PASS",
      "- 논의가 아직 충분하지 않다면 적극적으로 SPEAK",
    ].join("\n");
  }

  _buildSpeakPrompt() {
    const transcriptLines = this.turns.length > 0
      ? this.turns.map((t) => `${t.name}: ${t.content}`).join("\n")
      : "(첫 번째 발언입니다)";

    const isTooEarly = this.turns.length < this.minTurns;

    return [
      `[회의 주제] ${this.topic}`,
      "",
      `[지금까지 대화]`,
      transcriptLines,
      "",
      "다음 발언을 하세요.",
      "- 2~4문장으로 답할 것",
      "- 이미 나온 표현과 주장 반복 금지",
      isTooEarly
        ? "- 아직 논의 초반이므로 질문, 반론, 다른 시각을 적극적으로 제시할 것"
        : "- 결정, 우선순위, 다음 액션 중 하나를 제안할 것",
      "- 인사, 서론, 군더더기 없이 바로 본론부터 시작할 것",
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
