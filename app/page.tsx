import Ripple from "@/components/canvasui/Ripple";
import Algae from "@/components/canvasui/Algae";
import Flowers from "@/components/canvasui/Flowers";
import Lotus from "@/components/canvasui/Lotus";
import Fish from "@/components/canvasui/Fish";

export default function Home() {
  return (
    <Flowers className="flex flex-1 items-center justify-center bg-cover bg-center font-sans">
      <Lotus className="flex h-full w-full items-center justify-center">
        <Ripple className="flex h-full w-full items-center justify-center" trigger="click">
          <Algae className="flex h-full w-full items-center justify-center">
            <Fish className="flex h-full w-full items-center justify-center">
              <main className="flex h-full w-full items-center justify-center" style={{ backgroundImage: "url(/pond.png)" }}>
                <span
                  className="text-6xl font-semibold text-white"
                  style={{ letterSpacing: "-3%" }}
                >
                  pond
                </span>
              </main>
            </Fish>
          </Algae>
        </Ripple>
      </Lotus>
    </Flowers>
  );
}
