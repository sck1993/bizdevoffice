/** @typedef {"idle"|"working"|"meeting"} AgentStatus */
/** @typedef {{ agentId: string, name: string, state: AgentStatus, taskTitle?: string, deskIndex?: number, spriteImage?: string | null, spriteFrames?: number }} AgentState */

class AgentStateStore {
  constructor() {
    /** @type {Map<string, AgentState>} */
    this.states = new Map();
  }

  set(agentId, data) {
    const existing = this.states.get(agentId) ?? {};
    this.states.set(agentId, { ...existing, ...data });
  }

  updateStatus(agentId, state, taskTitle) {
    const existing = this.states.get(agentId);
    if (!existing) return false;
    this.states.set(agentId, { ...existing, state, taskTitle });
    return true;
  }

  getAll() {
    return Array.from(this.states.values());
  }

  get(agentId) {
    return this.states.get(agentId);
  }

  delete(agentId) {
    return this.states.delete(agentId);
  }

  resetAll() {
    for (const [id, agentState] of this.states) {
      this.states.set(id, { ...agentState, state: "idle", taskTitle: undefined });
    }
  }
}

module.exports = { agentStateStore: new AgentStateStore() };
