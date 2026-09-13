"use client";

export function FishTrail({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden
    >
      <img
        src="/fishtrail.gif"
        alt=""
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "30%",
          aspectRatio: "1 / 1",
          objectFit: "contain",
        }}
      />
      <img
        src="/fishtrail2.gif"
        alt=""
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) scaleX(-1)",
          width: "38%",
          aspectRatio: "1 / 1",
          objectFit: "contain",
        }}
      />
    </div>
  );
}

export default FishTrail;
