---
name: tune-shader-params
description: Guided workflow for iterating on WebGL effect parameters (ripple decay/wavelength/refraction, fluid dissipation/curl/force, etc.) with visual verification in the running dev server. Use when the user wants to adjust how an existing canvasui effect looks or feels, not add a new one.
---

# Tune shader / effect parameters

Iterating on water/fluid "feel" is non-linear — small uniform changes compound. This skill is a loop, not a one-shot edit.

## Loop

1. **Identify the exact component and options** — `Ripple` (`RippleOptions`: amplitude, speed, wavelength, rings, decay, refraction, dispersion, shine, trigger, interval) or `Liquid` (`LiquidOptions`: simResolution, dyeResolution, densityDissipation, velocityDissipation, pressure, pressureIterations, curl, radius, force, intensity, distortion, blend, color, rainbow). Read the current values in `app/page.tsx` (or wherever the component is instantiated) before changing anything.
2. **Change one or two related params at a time** — e.g. `decay` + `wavelength` together (they jointly control ring width/lifespan), not five unrelated uniforms in one edit. Isolate cause and effect.
3. **Run the dev server** (`npm run dev`) if not already running, and use the `run` skill's pattern or Playwright MCP to load `http://localhost:3000` and actually trigger the effect (click for Ripple, pointer-move for Liquid) — do not judge "feel" from reading code.
4. **Screenshot or visually confirm** — take a screenshot before/after the interaction so the change is comparable, not just "looks fine at rest."
5. **Check the idle state too** — most of this page's lifetime is idle, not mid-ripple. Confirm the effect settles back to calm/transparent and the RAF loop actually stops (per the `running = false` early-return pattern in `Ripple.tsx`'s `frame()`), not spinning forever.
6. **Check `prefers-reduced-motion`** still degrades sensibly after the change.
7. **Run `pond-perf-check`** if the change touches resolution, iteration counts, or ripple/particle caps — those are the params most likely to affect frame time.

## Reference: what each Ripple param actually does

- `amplitude` — wave height / how strong the refraction+glint reads
- `speed` — outward propagation speed (multiplies `BASE_SPEED = 340`)
- `wavelength` — distance between crests; also scales ring width and speed falloff
- `rings` — number of crests per wave train (width = wavelength × rings × 0.5)
- `decay` — energy loss rate; higher = dies faster
- `refraction` — how far the shader displaces sampled content, in px
- `dispersion` — chromatic split (RGB sampled at slightly different offsets)
- `shine` — glint/shade intensity from the surface-normal-like gradient

## Reference: what each Liquid param actually does

- `simResolution` / `dyeResolution` — simulation vs. visible trail grid size (perf vs. fidelity trade-off — the biggest perf lever)
- `densityDissipation` / `velocityDissipation` — how long trails/motion persist (closer to 1 = longer)
- `pressure` / `pressureIterations` — incompressibility solve strength/accuracy
- `curl` — rotational force injected back into the flow (adds swirliness)
- `radius`, `force` — pointer splat size and push strength
- `intensity`, `distortion`, `blend` — how strongly the dye color/warp reads over content
- `color` / `rainbow` — fixed tint vs. direction-based rainbow coloring

Don't guess these from first principles — verify against `components/canvasui/Ripple.tsx` / `Liquid.tsx` if unsure, since exact formulas (e.g. the Gaussian envelope math) matter for predicting a change's effect.
