export function DisconnectBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        padding: "10px 16px",
        background: "#912018",
        color: "#fff7f4",
        textAlign: "center",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: "13px",
        letterSpacing: "0.04em",
      }}
    >
      서버 연결이 끊어졌습니다. 재연결을 시도하고 있습니다.
    </div>
  );
}
