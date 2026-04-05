import { GameWrapper } from "../components/GameWrapper";

export default function HomePage() {
  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background:
          "radial-gradient(circle at top left, rgba(38, 71, 119, 0.32), transparent 30%), linear-gradient(180deg, #0b1020 0%, #141b2d 100%)",
      }}
    >
      <GameWrapper />
    </main>
  );
}
