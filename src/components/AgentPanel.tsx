"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { EventBus } from "../game/EventBus";
import type { AgentConfig, AgentRemoved, AgentState, AgentStateChanged, AgentsSnapshot } from "../types/agent";

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const lines = text.split("\n");
  lines.forEach((line, li) => {
    if (li > 0) result.push(<br key={`br-${li}`} />);
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    parts.forEach((part, pi) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        result.push(<strong key={`b-${li}-${pi}`}>{part.slice(2, -2)}</strong>);
      } else {
        result.push(part);
      }
    });
  });
  return result;
}

function statusLabel(state: AgentState["state"], taskTitle?: string) {
  if (state === "working") return taskTitle ? `working: ${taskTitle}` : "working";
  if (state === "meeting") return "meeting";
  return "idle";
}

function statusColor(state: AgentState["state"]) {
  if (state === "working") return "#86f2b8";
  if (state === "meeting") return "#ffcc7a";
  return "rgba(228, 236, 255, 0.45)";
}

// ── AgentEditorModal ──────────────────────────────────────────────────────────

interface AgentEditorModalProps {
  mode: "create" | "edit";
  gatewayConnected: boolean;
  initialAgent?: AgentConfig;
  onClose: () => void;
  onSubmitted: (agent: AgentConfig) => void;
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
  const [staticAssets, setStaticAssets] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents/assets")
      .then((r) => r.json())
      .then((d) => setStaticAssets(d.assets ?? []))
      .catch(() => {});
  }, []);

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
      const response = await fetch("/api/agents/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Image upload failed");
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
      if (!response.ok) throw new Error(data?.error || `Agent ${isEdit ? "update" : "creation"} failed`);
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
                {staticAssets.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                    {staticAssets.map((url) => {
                      const selected = profileImage === url;
                      return (
                        <button
                          key={url}
                          type="button"
                          onClick={() => setProfileImage(selected ? null : url)}
                          title={url.split("/").pop()}
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 12,
                            border: selected
                              ? "2px solid #4db0ff"
                              : "1px solid rgba(255, 255, 255, 0.12)",
                            background: `center / cover no-repeat url(${url})`,
                            cursor: "pointer",
                            padding: 0,
                            outline: selected ? "2px solid rgba(77, 176, 255, 0.4)" : "none",
                            outlineOffset: 2,
                          }}
                        />
                      );
                    })}
                  </div>
                ) : null}
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
              onChange={(e) => setName(e.target.value)}
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
              onChange={(e) => setIdentity(e.target.value)}
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
              onChange={(e) => setSoul(e.target.value)}
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
              OpenClaw가 연결되어야 역할과 성격을 저장할 수 있습니다.
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

// ── AgentChatView ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  failed?: boolean;
  failedReason?: string;
}

interface ChatAgent {
  agentId: string;
  name: string;
  profileImage?: string | null;
  state: AgentState["state"];
  taskTitle?: string;
}

function AgentChatView({ agent, onBack }: { agent: ChatAgent; onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/agents/${agent.agentId}/chat`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { messages?: ChatMessage[] }) => {
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error("[chat] failed to load history:", e);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [agent.agentId]);

  async function sendMessage(text: string) {
    setSending(true);
    console.log(`[chat] → sending to agent ${agent.agentId}:`, text);

    try {
      const response = await fetch(`/api/agents/${agent.agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error(`[chat] ← HTTP ${response.status}:`, data);
        throw new Error(data?.error || "Failed to get response");
      }
      console.log(`[chat] ← response:`, data.content);
      setMessages((prev) => [...prev, { role: "assistant", content: data.content as string }]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "응답을 받지 못했습니다.";
      console.error(`[chat] ← error:`, errMsg);
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 && m.role === "user" ? { ...m, failed: true, failedReason: errMsg } : m,
        ),
      );
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    await sendMessage(text);
  }

  async function handleRetry(index: number) {
    const msg = messages[index];
    if (!msg || msg.role !== "user") return;
    // 실패 메시지 복구 후 재전송
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, failed: false } : m)));
    await sendMessage(msg.content);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const avatarStyle = {
    borderRadius: 8,
    flexShrink: 0 as const,
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: agent.profileImage
      ? `center / cover no-repeat url(${agent.profileImage})`
      : "linear-gradient(135deg, rgba(80, 177, 255, 0.3), rgba(255, 163, 95, 0.28))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    color: "#eff7ff",
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 28,
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background:
          "linear-gradient(180deg, rgba(17, 24, 43, 0.92) 0%, rgba(10, 14, 26, 0.97) 100%)",
        boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
        color: "#edf4ff",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 14px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: 999,
            border: "1px solid rgba(255, 255, 255, 0.1)",
            background: "rgba(255, 255, 255, 0.05)",
            color: "#c4d4f0",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
          }}
        >
          ←
        </button>
        <div
          style={{
            ...avatarStyle,
            width: 34,
            height: 34,
            fontSize: 13,
          }}
        >
          {!agent.profileImage ? agent.name.slice(0, 1).toUpperCase() : null}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {agent.name}
          </div>
          <div style={{ fontSize: 11, color: statusColor(agent.state), marginTop: 1 }}>
            {statusLabel(agent.state, agent.taskTitle)}
          </div>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 12px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {loading ? (
          <div
            style={{
              margin: "auto",
              textAlign: "center",
              color: "rgba(228, 236, 255, 0.35)",
              fontSize: 13,
            }}
          >
            대화 기록 불러오는 중...
          </div>
        ) : messages.length === 0 && !sending ? (
          <div
            style={{
              margin: "auto",
              textAlign: "center",
              color: "rgba(228, 236, 255, 0.35)",
              fontSize: 13,
              lineHeight: 1.7,
              padding: "0 8px",
            }}
          >
            {agent.name}에게
            <br />
            메시지를 보내보세요.
          </div>
        ) : null}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                alignItems: "flex-end",
                gap: 7,
                width: "100%",
              }}
            >
              {msg.role === "assistant" ? (
                <div style={{ ...avatarStyle, width: 24, height: 24, fontSize: 9, marginBottom: 2 }}>
                  {!agent.profileImage ? agent.name.slice(0, 1).toUpperCase() : null}
                </div>
              ) : null}
              <div
                style={{
                  maxWidth: "80%",
                  borderRadius:
                    msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  padding: "9px 12px",
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background:
                    msg.role === "user"
                      ? msg.failed
                        ? "rgba(255, 87, 87, 0.12)"
                        : "linear-gradient(135deg, rgba(77, 176, 255, 0.28), rgba(99, 156, 255, 0.22))"
                      : "rgba(255, 255, 255, 0.06)",
                  border:
                    msg.role === "user"
                      ? msg.failed
                        ? "1px solid rgba(255, 87, 87, 0.4)"
                        : "1px solid rgba(77, 176, 255, 0.3)"
                      : "1px solid rgba(255, 255, 255, 0.07)",
                  color: msg.failed ? "#ffb3b3" : "#edf4ff",
                  opacity: msg.failed ? 0.85 : 1,
                }}
              >
                {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
              </div>
            </div>
            {msg.failed ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 2 }}>
                <span style={{ fontSize: 11, color: "rgba(255, 130, 130, 0.8)" }}>전송 실패</span>
                <button
                  type="button"
                  onClick={() => void handleRetry(i)}
                  disabled={sending}
                  style={{
                    fontSize: 11,
                    color: "#ffb3b3",
                    background: "transparent",
                    border: "1px solid rgba(255, 130, 130, 0.35)",
                    borderRadius: 999,
                    padding: "2px 8px",
                    cursor: sending ? "not-allowed" : "pointer",
                    opacity: sending ? 0.5 : 1,
                  }}
                >
                  재전송
                </button>
              </div>
            ) : null}
          </div>
        ))}

        {sending ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 7 }}>
            <div style={{ ...avatarStyle, width: 24, height: 24, fontSize: 9, marginBottom: 2 }}>
              {!agent.profileImage ? agent.name.slice(0, 1).toUpperCase() : null}
            </div>
            <div
              style={{
                borderRadius: "16px 16px 16px 4px",
                padding: "10px 16px",
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.07)",
                color: "rgba(228, 236, 255, 0.5)",
                fontSize: 18,
                letterSpacing: 4,
                lineHeight: 1,
              }}
            >
              ···
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div
        style={{
          flexShrink: 0,
          padding: "8px 12px 12px",
          borderTop: "1px solid rgba(255, 255, 255, 0.07)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
            background: "rgba(255, 255, 255, 0.04)",
            borderRadius: 18,
            border: "1px solid rgba(255, 255, 255, 0.1)",
            padding: "8px 8px 8px 13px",
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`${agent.name}에게 메시지...`}
            rows={1}
            disabled={loading || sending}
            style={{
              flex: 1,
              resize: "none",
              border: "none",
              background: "transparent",
              color: "#edf4ff",
              fontSize: 13,
              outline: "none",
              lineHeight: 1.5,
              maxHeight: 96,
              overflowY: "auto",
              padding: 0,
            }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            style={{
              flexShrink: 0,
              width: 30,
              height: 30,
              borderRadius: 9,
              border: "none",
              background:
                input.trim() && !sending
                  ? "linear-gradient(135deg, #54b8ff 0%, #ff9c67 100%)"
                  : "rgba(255, 255, 255, 0.08)",
              color:
                input.trim() && !sending ? "#07111d" : "rgba(255, 255, 255, 0.3)",
              cursor: input.trim() && !sending ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            ↑
          </button>
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 10,
            color: "rgba(228, 236, 255, 0.25)",
            textAlign: "center",
          }}
        >
          Enter 전송 · Shift+Enter 줄바꿈
        </div>
      </div>
    </div>
  );
}

// ── AgentPanel ────────────────────────────────────────────────────────────────

export function AgentPanel() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [states, setStates] = useState<AgentState[]>([]);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshConfigs() {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to load agents");
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
      if (response.ok) setGatewayConnected(Boolean(data.connected));
    } catch {
      setGatewayConnected(false);
    }
  }

  useEffect(() => {
    void refreshConfigs();
    void refreshGatewayStatus();
    const interval = window.setInterval(() => void refreshGatewayStatus(), 5000);
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
        current.map((s) => (s.agentId === agentId ? { ...s, state, taskTitle } : s)),
      );
    };
    const handleRemoved = (payload: unknown) => {
      const { agentId } = payload as AgentRemoved;
      setConfigs((current) => current.filter((a) => a.agentId !== agentId));
      setStates((current) => current.filter((a) => a.agentId !== agentId));
      setEditingAgent((current) => (current?.agentId === agentId ? null : current));
      setChatAgentId((current) => (current === agentId ? null : current));
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
      state: state?.state ?? ("idle" as AgentState["state"]),
      taskTitle: state?.taskTitle,
    };
  });

  const chatAgent = chatAgentId
    ? (merged.find((a) => a.agentId === chatAgentId) ?? null)
    : null;

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
      setConfigs((current) => current.filter((a) => a.agentId !== agentId));
      setStates((current) => current.filter((a) => a.agentId !== agentId));
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
    setConfigs((current) =>
      current.map((item) => (item.agentId === agent.agentId ? agent : item)),
    );
    setEditingAgent(null);
    setError(null);
  }

  // 채팅 뷰
  if (chatAgent) {
    return <AgentChatView agent={chatAgent} onBack={() => setChatAgentId(null)} />;
  }

  // 에이전트 목록 뷰
  return (
    <>
      <aside
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: 28,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background:
            "linear-gradient(180deg, rgba(17, 24, 43, 0.92) 0%, rgba(10, 14, 26, 0.97) 100%)",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
          color: "#edf4ff",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            flexShrink: 0,
            padding: "18px 18px 14px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>Agents</div>
              <div style={{ marginTop: 4, fontSize: 12, color: "rgba(228, 236, 255, 0.65)" }}>
                OpenClaw 워크스페이스와 연결된 에이전트
              </div>
            </div>
            <div
              style={{
                borderRadius: 999,
                padding: "6px 9px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: gatewayConnected ? "#0d2819" : "#472112",
                background: gatewayConnected ? "#86f2b8" : "#ffc08f",
                whiteSpace: "nowrap",
              }}
            >
              {gatewayConnected ? "OPENCLAW ON" : "OPENCLAW OFF"}
            </div>
          </div>
        </div>

        {/* 에이전트 목록 (스크롤) */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 12px 0",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {loading ? (
            <div style={{ color: "rgba(228, 236, 255, 0.6)", fontSize: 13 }}>
              불러오는 중...
            </div>
          ) : merged.length === 0 ? (
            <div
              style={{
                borderRadius: 20,
                padding: 18,
                background: "rgba(255, 255, 255, 0.04)",
                color: "rgba(228, 236, 255, 0.65)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              아직 생성된 에이전트가 없습니다.
            </div>
          ) : (
            merged.map((agent) => (
              <div
                key={agent.agentId}
                onClick={() => setChatAgentId(agent.agentId)}
                style={{
                  borderRadius: 18,
                  padding: "12px 12px 10px",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  cursor: "pointer",
                }}
              >
                {/* 에이전트 정보 */}
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 13,
                      flexShrink: 0,
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      background: agent.profileImage
                        ? `center / cover no-repeat url(${agent.profileImage})`
                        : "linear-gradient(135deg, rgba(80, 177, 255, 0.3), rgba(255, 163, 95, 0.28))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#eff7ff",
                      fontWeight: 700,
                      fontSize: 15,
                    }}
                  >
                    {!agent.profileImage ? agent.name.slice(0, 1).toUpperCase() : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{agent.name}</div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 11,
                        color: statusColor(agent.state),
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {statusLabel(agent.state, agent.taskTitle)}
                    </div>
                  </div>
                  <div style={{ color: "rgba(228, 236, 255, 0.25)", fontSize: 16 }}>›</div>
                </div>

                {/* 태그 + 액션 버튼 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 9,
                    gap: 6,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span
                    style={{
                      borderRadius: 999,
                      background: "rgba(77, 176, 255, 0.13)",
                      color: "#a6d8ff",
                      padding: "3px 7px",
                      fontSize: 10,
                    }}
                  >
                    desk: {agent.deskIndex >= 0 ? agent.deskIndex + 1 : "lounge"}
                  </span>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button
                      type="button"
                      onClick={() => setEditingAgent(agent)}
                      style={{
                        borderRadius: 999,
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        background: "rgba(255, 255, 255, 0.06)",
                        color: "#e5eeff",
                        padding: "5px 9px",
                        fontSize: 11,
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
                        padding: "5px 9px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}

          {error ? (
            <div
              style={{
                borderRadius: 14,
                padding: "10px 13px",
                background: "rgba(255, 87, 87, 0.14)",
                border: "1px solid rgba(255, 87, 87, 0.26)",
                color: "#ffd8d8",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

        {/* 하단 버튼 */}
        <div style={{ flexShrink: 0, padding: "12px 12px 14px" }}>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            style={{
              width: "100%",
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(135deg, #54b8ff 0%, #ff9c67 100%)",
              color: "#07111d",
              padding: "13px 18px",
              fontWeight: 800,
              cursor: "pointer",
              boxShadow: "0 12px 32px rgba(77, 176, 255, 0.2)",
            }}
          >
            + 에이전트 추가
          </button>
        </div>
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
