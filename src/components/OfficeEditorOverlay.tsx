"use client";

import { EventBus } from "../game/EventBus";
import type { OfficeConfig, PropType } from "../types/office";

interface OfficeEditorOverlayProps {
  onClose: () => void;
}

const PROP_BUTTONS: { type: PropType; label: string; color: string }[] = [
  { type: "desk", label: "데스크 추가", color: "#4a9eff" },
  { type: "meeting_chair", label: "회의 의자 추가", color: "#5ec99a" },
  { type: "sofa", label: "소파 추가", color: "#ff9a56" },
];

export function OfficeEditorOverlay({ onClose }: OfficeEditorOverlayProps) {
  const handleSave = async () => {
    // emit 전에 핸들러를 등록해 EventBus 동기 응답을 놓치지 않음
    const config = await new Promise<OfficeConfig>((resolve) => {
      const handler = (cfg: unknown) => {
        EventBus.off("office:config-updated", handler);
        resolve(cfg as OfficeConfig);
      };
      EventBus.on("office:config-updated", handler);
      EventBus.emit("office:edit-save");
    });

    try {
      const res = await fetch("/api/office/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) {
        console.error("[OfficeEditorOverlay] PUT failed", await res.text());
      }
    } catch (err) {
      console.error("[OfficeEditorOverlay] PUT error", err);
    }

    onClose();
  };

  const handleCancel = () => {
    EventBus.emit("office:edit-cancel");
    onClose();
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 20,
      }}
    >
      {/* 상단 툴바 */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          backgroundColor: "rgba(10, 14, 26, 0.88)",
          border: "1px solid rgba(74, 158, 255, 0.4)",
          borderRadius: 12,
          padding: "8px 14px",
          pointerEvents: "auto",
          backdropFilter: "blur(8px)",
        }}
      >
        <span style={{ color: "#88c4ff", fontSize: 13, fontWeight: 600, marginRight: 4 }}>
          오피스 편집
        </span>

        {PROP_BUTTONS.map(({ type, label, color }) => (
          <button
            key={type}
            onClick={() => EventBus.emit("office:add-prop", { type })}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              border: `1px solid ${color}88`,
              backgroundColor: `${color}22`,
              color,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + {label}
          </button>
        ))}

        <div style={{ width: 1, height: 20, backgroundColor: "rgba(255,255,255,0.15)", margin: "0 4px" }} />

        <button
          onClick={handleSave}
          style={{
            padding: "4px 14px",
            borderRadius: 8,
            border: "1px solid #5ec99a88",
            backgroundColor: "#5ec99a22",
            color: "#5ec99a",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          저장
        </button>

        <button
          onClick={handleCancel}
          style={{
            padding: "4px 14px",
            borderRadius: 8,
            border: "1px solid #ff6b6b88",
            backgroundColor: "#ff6b6b22",
            color: "#ff9a9a",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          취소
        </button>
      </div>

      {/* 하단 안내 */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          color: "rgba(255,255,255,0.45)",
          fontSize: 11,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        마커를 드래그해 타일에 배치 • × 버튼으로 삭제 (사용 중인 데스크는 삭제 불가)
      </div>
    </div>
  );
}
