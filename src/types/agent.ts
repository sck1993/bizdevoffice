export type AgentStatus = "idle" | "working" | "meeting";

export interface AgentState {
  agentId: string;
  name: string;
  state: AgentStatus;
  taskTitle?: string;
}

export interface AgentsSnapshot {
  agents: AgentState[];
}

export interface AgentStateChanged {
  agentId: string;
  state: AgentStatus;
  taskTitle?: string;
}
