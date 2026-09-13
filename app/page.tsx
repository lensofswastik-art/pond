import Ripple from "@/components/canvasui/Ripple";

export default function Home() {
  return (
    <Ripple
      className="flex flex-1 items-center justify-center font-sans"
      style={{ backgroundColor: "#00A6FB" }}
      trigger="click"
      amplitude={1.4}
      refraction={220}
      shine={1.1}
      speed={0.85}
    >
      <main className="flex h-full w-full items-center justify-center">
        <span
          className="text-6xl font-semibold text-white"
          style={{ letterSpacing: "-3%" }}
        >
          pond
        </span>
      </main>
    </Ripple>
  );
}
