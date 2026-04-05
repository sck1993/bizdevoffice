"use client";

import { useEffect, useState } from "react";

import { EventBus } from "../game/EventBus";
import type { AgentConfig, AgentRemoved, AgentState, AgentsSnapshot } from "../types/agent";

interface CreateModalProps {
  gatewayConnected: boolean;
  onClose: () => void;
  onCreated: (agent: AgentConfig) => void;
}

function statusLabel(state: AgentState["state"], taskTitle?: string) {
  if (state === "working") {
    return taskTitle ? `working: ${taskTitle}` : "working";
  }
  if (state === "meeting") return "meeting";
  return "idle";
}

function CreateAgentModal({ gatewayConnected, onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [soul, setSoul] = useState("");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    gatewayConnected &&
    !uploading &&
    !submitting &&
    name.trim().length > 0 &&
    identity.trim().length > 0 &&
    soul.trim().length > 0;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/agents/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Image upload failed");
      }

      setProfileImage(data.url);
    } catch (uploadError) {
      setProfileImage(null);
      setError(uploadError instanceof Error ? uploadError.message : "Image upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;

    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          identity,
          soul,
          profileImage,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Agent creation failed");
      }

      onCreated(data.agent as AgentConfig);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Agent creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(5, 9, 19, 0.72)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          borderRadius: 24,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background:
            "linear-gradient(180deg, rgba(18, 27, 48, 0.96) 0%, rgba(11, 17, 30, 0.98) 100%)",
          boxShadow: "0 28px 100px rgba(0, 0, 0, 0.45)",
          color: "#eef4ff",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 24px 14px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700 }}>새 에이전트 추가</div>
          <div style={{ marginTop: 6, color: "rgba(228, 236, 255, 0.7)", fontSize: 14 }}>
            이름, 역할, 성격을 입력하면 OpenClaw 워크스페이스와 오피스 씬에 바로 반영됩니다.
          </div>
        </div>

        <div style={{ padding: 24, display: "grid", gap: 16 }}>
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#c9d4eb" }}>프로필 사진</span>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  background: profileImage
                    ? `center / cover no-repeat url(${profileImage})`
                    : "linear-gradient(135deg, rgba(71, 173, 255, 0.28), rgba(255, 150, 79, 0.3))",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                }}
              >
                {!profileImage ? "AI" : null}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
                <div style={{ fontSize: 12, color: "rgba(228, 236, 255, 0.65)" }}>
                  JPEG, PNG, WEBP. 최대 2MB.
                  {uploading ? " 업로드 중..." : ""}
                </div>
              </div>
            </div>
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#c9d4eb" }}>이름</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Alice"
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#f5f8ff",
                padding: "13px 14px",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#c9d4eb" }}>역할 (Identity)</span>
            <textarea
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              rows={5}
              placeholder="당신은 프론트엔드 개발자입니다..."
              style={{
                resize: "vertical",
                borderRadius: 16,
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#f5f8ff",
                padding: "13px 14px",
                outline: "none",
                minHeight: 120,
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#c9d4eb" }}>성격 (Soul)</span>
            <textarea
              value={soul}
              onChange={(event) => setSoul(event.target.value)}
              rows={5}
              placeholder="완벽주의적이고 조용하지만 필요할 때 직설적입니다..."
              style={{
                resize: "vertical",
                borderRadius: 16,
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#f5f8ff",
                padding: "13px 14px",
                outline: "none",
                minHeight: 120,
              }}
            />
          </label>

          {!gatewayConnected ? (
            <div
              style={{
                borderRadius: 16,
                padding: "12px 14px",
                background: "rgba(255, 132, 95, 0.14)",
                border: "1px solid rgba(255, 132, 95, 0.25)",
                color: "#ffd8cd",
                fontSize: 13,
              }}
            >
              OpenClaw 연결이 필요합니다. 연결되면 생성 버튼이 활성화됩니다.
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                borderRadius: 16,
                padding: "12px 14px",
                background: "rgba(255, 87, 87, 0.14)",
                border: "1px solid rgba(255, 87, 87, 0.26)",
                color: "#ffd8d8",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: 24,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255, 255, 255, 0.12)",
              background: "transparent",
              color: "#dce6fb",
              padding: "10px 16px",
              cursor: "pointer",
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              borderRadius: 999,
              border: "none",
              background: canSubmit
                ? "linear-gradient(135deg, #4db0ff 0%, #ff9c67 100%)"
                : "rgba(255, 255, 255, 0.12)",
              color: canSubmit ? "#08101c" : "rgba(255, 255, 255, 0.52)",
              padding: "10px 18px",
              fontWeight: 700,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "생성 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentPanel() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [states, setStates] = useState<AgentState[]>([]);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshConfigs() {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load agents");
      }
      setConfigs(data.agents as AgentConfig[]);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }

  async function refreshGatewayStatus() {
    try {
      const response = await fetch("/api/gateway/status", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) {
        setGatewayConnected(Boolean(data.connected));
      }
    } catch {
      setGatewayConnected(false);
    }
  }

  useEffect(() => {
    void refreshConfigs();
    void refreshGatewayStatus();

    const interval = window.setInterval(() => {
      void refreshGatewayStatus();
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleSnapshot = (payload: unknown) => {
      const { agents } = payload as AgentsSnapshot;
      setStates(Array.isArray(agents) ? agents : []);
    };

    const handleRemoved = (payload: unknown) => {
      const { agentId } = payload as AgentRemoved;
      setConfigs((current) => current.filter((agent) => agent.agentId !== agentId));
      setStates((current) => current.filter((agent) => agent.agentId !== agentId));
    };

    EventBus.on("agents:snapshot", handleSnapshot);
    EventBus.on("agent:removed", handleRemoved);

    return () => {
      EventBus.off("agents:snapshot", handleSnapshot);
      EventBus.off("agent:removed", handleRemoved);
    };
  }, []);

  const merged = configs.map((config) => {
    const state = states.find((item) => item.agentId === config.agentId);
    return {
      ...config,
      state: state?.state ?? "idle",
      taskTitle: state?.taskTitle,
    };
  });

  async function handleDelete(agentId: string) {
    const confirmed = window.confirm("이 에이전트를 삭제할까요?");
    if (!confirmed) return;

    setError(null);

    try {
      const response = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Agent deletion failed");
      }

      setConfigs((current) => current.filter((agent) => agent.agentId !== agentId));
      setStates((current) => current.filter((agent) => agent.agentId !== agentId));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Agent deletion failed");
    }
  }

  function handleCreated(agent: AgentConfig) {
    setConfigs((current) => [...current, agent]);
    setShowCreateModal(false);
  }

  return (
    <>
      <aside
        style={{
          width: "min(100%, 360px)",
          borderRadius: 28,
          padding: 20,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background:
            "linear-gradient(180deg, rgba(17, 24, 43, 0.92) 0%, rgba(10, 14, 26, 0.97) 100%)",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
          color: "#edf4ff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>Agents</div>
            <div style={{ marginTop: 4, fontSize: 13, color: "rgba(228, 236, 255, 0.7)" }}>
              OpenClaw 워크스페이스와 연결된 에이전트 목록
            </div>
          </div>
          <div
            style={{
              borderRadius: 999,
              padding: "7px 10px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: gatewayConnected ? "#0d2819" : "#472112",
              background: gatewayConnected ? "#86f2b8" : "#ffc08f",
            }}
          >
            {gatewayConnected ? "OPENCLAW ON" : "OPENCLAW OFF"}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            minHeight: 180,
          }}
        >
          {loading ? (
            <div style={{ color: "rgba(228, 236, 255, 0.72)", fontSize: 14 }}>에이전트 목록을 불러오는 중입니다...</div>
          ) : merged.length === 0 ? (
            <div
              style={{
                borderRadius: 22,
                padding: 20,
                background: "rgba(255, 255, 255, 0.04)",
                color: "rgba(228, 236, 255, 0.72)",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              아직 생성된 에이전트가 없습니다. 오른쪽 패널에서 새 팀원을 추가해보세요.
            </div>
          ) : (
            merged.map((agent) => (
              <div
                key={agent.agentId}
                style={{
                  borderRadius: 22,
                  padding: 14,
                  background: "linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03))",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      background: agent.profileImage
                        ? `center / cover no-repeat url(${agent.profileImage})`
                        : "linear-gradient(135deg, rgba(80, 177, 255, 0.3), rgba(255, 163, 95, 0.28))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#eff7ff",
                      fontWeight: 700,
                    }}
                  >
                    {!agent.profileImage ? agent.name.slice(0, 1).toUpperCase() : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{agent.name}</div>
                    <div
                      style={{
                        marginTop: 4,
                        color: "rgba(228, 236, 255, 0.72)",
                        fontSize: 13,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {statusLabel(agent.state, agent.taskTitle)}
                    </div>
                    <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          borderRadius: 999,
                          background: "rgba(77, 176, 255, 0.14)",
                          color: "#a6d8ff",
                          padding: "4px 8px",
                          fontSize: 11,
                        }}
                      >
                        id: {agent.agentId}
                      </span>
                      <span
                        style={{
                          borderRadius: 999,
                          background: "rgba(255, 156, 103, 0.14)",
                          color: "#ffc9ac",
                          padding: "4px 8px",
                          fontSize: 11,
                        }}
                      >
                        desk: {agent.deskIndex >= 0 ? agent.deskIndex + 1 : "lounge"}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => void handleDelete(agent.agentId)}
                    style={{
                      borderRadius: 999,
                      border: "1px solid rgba(255, 122, 122, 0.25)",
                      background: "rgba(255, 102, 102, 0.08)",
                      color: "#ffb7b7",
                      padding: "8px 12px",
                      cursor: "pointer",
                    }}
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {error ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 16,
              padding: "12px 14px",
              background: "rgba(255, 87, 87, 0.14)",
              border: "1px solid rgba(255, 87, 87, 0.26)",
              color: "#ffd8d8",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          style={{
            width: "100%",
            marginTop: 18,
            borderRadius: 999,
            border: "none",
            background: "linear-gradient(135deg, #54b8ff 0%, #ff9c67 100%)",
            color: "#07111d",
            padding: "14px 18px",
            fontWeight: 800,
            cursor: "pointer",
            boxShadow: "0 18px 40px rgba(77, 176, 255, 0.22)",
          }}
        >
          + 에이전트 추가
        </button>
      </aside>

      {showCreateModal ? (
        <CreateAgentModal
          gatewayConnected={gatewayConnected}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      ) : null}
    </>
  );
}
