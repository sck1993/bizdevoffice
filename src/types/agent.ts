export type AgentStatus = "idle" | "working" | "meeting";

export interface AgentState {
  agentId: string;
  name: string;
  state: AgentStatus;
  taskTitle?: string;
  deskIndex?: number;
  spriteImage?: string | null;
}

export interface AgentConfig {
  agentId: string;
  name: string;
  identity: string;
  soul: string;
  profileImage: string | null;
  deskIndex: number;
  createdAt: string;
}

export interface AgentsSnapshot {
  agents: AgentState[];
}

export interface AgentStateChanged {
  agentId: string;
  state: AgentStatus;
  taskTitle?: string;
}

export interface AgentRemoved {
  agentId: string;
}
