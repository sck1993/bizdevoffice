"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import { AgentPanel } from "./AgentPanel";
import { DisconnectBanner } from "./DisconnectBanner";
import { OfficeEditorOverlay } from "./OfficeEditorOverlay";
import { EventBus } from "../game/EventBus";

export function GameWrapper() {
  const gameRef = useRef<HTMLDivElement>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    let disposed = false;
    let socket: Socket | null = null;
    let game: import("phaser").Game | null = null;

    const init = async () => {
      const Phaser = await import("phaser");
      const { GAME_HEIGHT, GAME_WIDTH } = await import("../game/config");
      const { OfficeScene } = await import("../game/scenes/OfficeScene");

      if (disposed || !gameRef.current) return;

      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent: gameRef.current,
        backgroundColor: "#121722",
        scene: [OfficeScene],
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        render: {
          antialias: true,
          roundPixels: false,
        },
      });

      socket = io();

      socket.on("connect", () => {
        console.log("[socket] connected", socket?.id);
        setDisconnected(false);
        EventBus.emit("connection:restored");
      });

      socket.on("disconnect", (reason) => {
        console.log("[socket] disconnected", reason);
        setDisconnected(true);
        EventBus.emit("connection:lost");
      });

      socket.on("agents:snapshot", (data) => {
        console.log("[socket] agents:snapshot", data);
        EventBus.emit("agents:snapshot", data);
      });

      socket.on("agent:state-changed", (data) => {
        console.log("[socket] agent:state-changed", data);
        EventBus.emit("agent:state-changed", data);
      });

      socket.on("agent:removed", (data) => {
        console.log("[socket] agent:removed", data);
        EventBus.emit("agent:removed", data);
      });

      socket.on("office:config", (data) => {
        console.log("[socket] office:config", data);
        EventBus.emit("office:config", data);
      });
    };

    void init();

    return () => {
      disposed = true;
      socket?.disconnect();
      game?.destroy(true);
    };
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        gap: 12,
        padding: 12,
        alignItems: "stretch",
        boxSizing: "border-box",
      }}
    >
      <DisconnectBanner visible={disconnected} />

      {/* 오피스 캔버스 — 남은 공간 전부 차지 */}
      <div
        style={{
          flex: "1 1 0",
          minWidth: 0,
          borderRadius: 20,
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.45)",
          position: "relative",
        }}
      >
        <div
          ref={gameRef}
          style={{ width: "100%", height: "100%" }}
        />

        {/* 오피스 편집 버튼 */}
        {!editMode && (
          <button
            onClick={() => {
              setEditMode(true);
              EventBus.emit("office:edit-start");
            }}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 15,
              padding: "5px 12px",
              borderRadius: 8,
              border: "1px solid rgba(74, 158, 255, 0.5)",
              backgroundColor: "rgba(10, 14, 26, 0.8)",
              color: "#88c4ff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              backdropFilter: "blur(6px)",
            }}
          >
            오피스 편집
          </button>
        )}

        {editMode && (
          <OfficeEditorOverlay onClose={() => setEditMode(false)} />
        )}
      </div>

      {/* 에이전트 패널 — 고정 너비 사이드바 */}
      <div
        style={{
          flexShrink: 0,
          width: 340,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <AgentPanel />
      </div>
    </div>
  );
}
