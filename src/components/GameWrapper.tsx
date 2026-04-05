"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import { AgentPanel } from "./AgentPanel";
import { DisconnectBanner } from "./DisconnectBanner";
import { EventBus } from "../game/EventBus";

export function GameWrapper() {
  const gameRef = useRef<HTMLDivElement>(null);
  const [disconnected, setDisconnected] = useState(false);

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
    };

    void init();

    return () => {
      disposed = true;
      socket?.disconnect();
      game?.destroy(true);
    };
  }, []);

  return (
    <>
      <DisconnectBanner visible={disconnected} />
      <div
        style={{
          width: "100%",
          maxWidth: 1680,
          margin: "0 auto",
          display: "flex",
          gap: 24,
          alignItems: "flex-start",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            flex: "1 1 960px",
            minWidth: 320,
            maxWidth: 1280,
            borderRadius: 28,
            overflow: "hidden",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div ref={gameRef} />
        </div>
        <AgentPanel />
      </div>
    </>
  );
}
