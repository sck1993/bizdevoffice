"use client";

import { useEffect, useState, type ChangeEvent } from "react";

import { EventBus } from "../game/EventBus";
import type { AgentConfig, AgentRemoved, AgentState, AgentStateChanged, AgentsSnapshot } from "../types/agent";

interface AgentEditorModalProps {
  mode: "create" | "edit";
  gatewayConnected: boolean;
  initialAgent?: AgentConfig;
  onClose: () => void;
  onSubmitted: (agent: AgentConfig) => void;
}

function statusLabel(state: AgentState["state"], taskTitle?: string) {
  if (state === "working") {
    return taskTitle ? `working: ${taskTitle}` : "working";
  }
  if (state === "meeting") return "meeting";
  return "idle";
}

function AgentEditorModal({
  mode,
  gatewayConnected,
  initialAgent,
  onClose,
  onSubmitted,
}: AgentEditorModalProps) {
  const isEdit = mode === "edit";
  const [name, setName] = useState(initialAgent?.name ?? "");
  const [identity, setIdentity] = useState(initialAgent?.identity ?? "");
  const [soul, setSoul] = useState(initialAgent?.soul ?? "");
  const [profileImage, setProfileImage] = useState<string | null>(initialAgent?.profileImage ?? null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedIdentity = identity.trim();
  const trimmedSoul = soul.trim();
  const remoteFieldsChanged =
    isEdit &&
    (trimmedIdentity !== (initialAgent?.identity ?? "") || trimmedSoul !== (initialAgent?.soul ?? ""));
  const canSubmit =
    !uploading &&
    !submitting &&
    trimmedName.length > 0 &&
    trimmedIdentity.length > 0 &&
    trimmedSoul.length > 0 &&
    (isEdit ? gatewayConnected || !remoteFieldsChanged : gatewayConnected);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
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
      const response = await fetch(
        isEdit ? `/api/agents/${initialAgent?.agentId}` : "/api/agents",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            identity: trimmedIdentity,
            soul: trimmedSoul,
            profileImage,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Agent ${isEdit ? "update" : "creation"} failed`);
      }

      onSubmitted(data.agent as AgentConfig);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `Agent ${isEdit ? "update" : "creation"} failed`);
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
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {isEdit ? "에이전트 수정" : "새 에이전트 추가"}
          </div>
          <div style={{ marginTop: 6, color: "rgba(228, 236, 255, 0.7)", fontSize: 14 }}>
            {isEdit
              ? "표시 이름, 역할, 성격, 프로필 이미지를 수정할 수 있습니다."
              : "이름, 역할, 성격을 입력하면 OpenClaw 워크스페이스와 오피스 씬에 바로 반영됩니다."}
          </div>
          {isEdit && initialAgent ? (
            <div
              style={{
                marginTop: 10,
                display: "inline-flex",
                borderRadius: 999,
                padding: "5px 10px",
                fontSize: 12,
                color: "#a8d8ff",
                background: "rgba(77, 176, 255, 0.14)",
              }}
            >
              id: {initialAgent.agentId}
            </div>
          ) : null}
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
                {profileImage ? (
                  <button
                    type="button"
                    onClick={() => setProfileImage(null)}
                    style={{
                      width: "fit-content",
                      borderRadius: 999,
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      background: "transparent",
                      color: "#dce6fb",
                      padding: "7px 10px",
                      cursor: "pointer",
                    }}
                  >
                    이미지 제거
                  </button>
                ) : null}
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

          {!gatewayConnected && !isEdit ? (
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

          {!gatewayConnected && isEdit && remoteFieldsChanged ? (
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
              OpenClaw가 연결되어야 역할과 성격을 저장할 수 있습니다. 이름이나 프로필 사진만 바꾸는 경우에는 저장할 수 있습니다.
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
            {submitting ? (isEdit ? "저장 중..." : "생성 중...") : isEdit ? "저장" : "생성"}
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
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshConfigs() {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load agents");
      }
      setConfigs(data.agents as AgentConfig[]);
      setError(null);
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

    const handleStateChanged = (payload: unknown) => {
      const { agentId, state, taskTitle } = payload as AgentStateChanged;
      setStates((current) =>
        current.map((s) => s.agentId === agentId ? { ...s, state, taskTitle } : s)
      );
    };

    const handleRemoved = (payload: unknown) => {
      const { agentId } = payload as AgentRemoved;
      setConfigs((current) => current.filter((agent) => agent.agentId !== agentId));
      setStates((current) => current.filter((agent) => agent.agentId !== agentId));
      setEditingAgent((current) => (current?.agentId === agentId ? null : current));
    };

    EventBus.on("agents:snapshot", handleSnapshot);
    EventBus.on("agent:state-changed", handleStateChanged);
    EventBus.on("agent:removed", handleRemoved);

    return () => {
      EventBus.off("agents:snapshot", handleSnapshot);
      EventBus.off("agent:state-changed", handleStateChanged);
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
    setError(null);
  }

  function handleUpdated(agent: AgentConfig) {
    setConfigs((current) => current.map((item) => (item.agentId === agent.agentId ? agent : item)));
    setEditingAgent(null);
    setError(null);
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
            <div style={{ color: "rgba(228, 236, 255, 0.72)", fontSize: 14 }}>
              에이전트 목록을 불러오는 중입니다...
            </div>
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

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => setEditingAgent(agent)}
                    style={{
                      borderRadius: 999,
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      background: "rgba(255, 255, 255, 0.06)",
                      color: "#e5eeff",
                      padding: "8px 12px",
                      cursor: "pointer",
                    }}
                  >
                    수정
                  </button>
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
        <AgentEditorModal
          mode="create"
          gatewayConnected={gatewayConnected}
          onClose={() => setShowCreateModal(false)}
          onSubmitted={handleCreated}
        />
      ) : null}

      {editingAgent ? (
        <AgentEditorModal
          mode="edit"
          gatewayConnected={gatewayConnected}
          initialAgent={editingAgent}
          onClose={() => setEditingAgent(null)}
          onSubmitted={handleUpdated}
        />
      ) : null}
    </>
  );
}
