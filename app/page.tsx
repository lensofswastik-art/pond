import Ripple from "@/components/canvasui/Ripple";

export default function Home() {
  return (
    <Ripple
      className="flex flex-1 items-center justify-center bg-cover bg-center font-sans"

      trigger="click"
    >
      <main className="flex h-full w-full items-center justify-center" style={{ backgroundImage: "url(/pond.png)" }}>
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
