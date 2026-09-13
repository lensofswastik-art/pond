import Ripple from "@/components/canvasui/Ripple";
import Algae from "@/components/canvasui/Algae";
import Flowers from "@/components/canvasui/Flowers";
import Lotus from "@/components/canvasui/Lotus";
import FishTrail from "@/components/FishTrail";

export default function Home() {
  return (
    <Flowers className="flex flex-1 items-center justify-center bg-cover bg-center font-sans">
      <Lotus className="flex h-full w-full items-center justify-center">
        <Lotus
          className="flex h-full w-full items-center justify-center"
          sources={["/lotus.png"]}
          count={3}
          scale={0.1}
        >
          <Ripple className="flex h-full w-full items-center justify-center" trigger="click">
            <Algae className="flex h-full w-full items-center justify-center">
              <main className="relative flex h-full w-full items-center justify-center" style={{ backgroundImage: "url(/pond.png)" }}>
                <FishTrail />
                <span
                  className="text-6xl font-semibold text-white"
                  style={{
                    letterSpacing: "-3%",
                    fontFamily: "var(--font-cedarville-cursive)",
                  }}
                >
                  pond
                </span>
              </main>
            </Algae>
          </Ripple>
        </Lotus>
      </Lotus>
    </Flowers>
  );
}
