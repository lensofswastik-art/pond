---
name: add-canvasui-effect
description: Scaffold a new canvasui.dev-style interactive WebGL effect component (like Ripple or Liquid) following this project's established pattern. Use when the user wants a new water/fluid/interactive visual effect added to the pond, distinct from tuning an existing one.
---

# Add a canvasui effect

Scaffold a new WebGL effect component in `components/canvasui/` that matches the shape of the existing `Ripple.tsx` and `Liquid.tsx`. Read both files first — they are the spec.

## Before starting

Read `node_modules/next/dist/docs/` for this project's Next.js conventions (per `AGENTS.md`) if the effect needs any routing/rendering integration beyond the component itself.

Read `components/canvasui/Ripple.tsx` and `components/canvasui/Liquid.tsx` in full. Do not start from a generic WebGL boilerplate — every new effect must match their structure so the codebase stays consistent.

## Checklist

1. **Clarify the effect's interaction model** — click-triggered (like Ripple), continuous pointer-driven (like Liquid), or ambient/idle-only. This determines which pointer listeners and idle-loop behavior to copy.
2. **Define the `*Options` interface + `DEFAULTS` const** — one field per tunable parameter, each with a one-line doc comment describing its visual effect in plain terms (see `RippleOptions` for the tone: "How quickly the waves lose energy (higher dies faster)").
3. **Define `*Elements` and `*Instance` interfaces** — `source`/`content`/`output` canvas triple; instance exposes `setOptions`, `resize`, `destroy`, plus any trigger methods (`splash`, `splat`, or a new verb specific to this effect).
4. **Write the GLSL** — WebGL2, `#version 300 es`, explicit `layout(location = 0)` vertex attribute. Keep the fragment shader self-contained. Let uniforms be auto-discovered (copy the `gl.getActiveUniform` loop) rather than hand-declaring locations.
5. **Implement the factory function** (`create<Effect>`):
   - Feature-detect html-in-canvas via the same pattern as `supportsHtmlInCanvas()` — reuse that exported function rather than reimplementing it.
   - Wire `ResizeObserver` (output + content) and `IntersectionObserver` (pause when off-screen) — copy from `Ripple.tsx`.
   - Respect `prefers-reduced-motion` via `matchMedia`.
   - `destroy()` must cancel RAF, remove all listeners, and delete every WebGL resource (texture/program/shader/buffer). No leaks — this runs indefinitely on a public page.
6. **Implement the React wrapper component**:
   - Three refs (source/content/output canvases), `useState` for `initialOptions` (captured once), `useSyncExternalStore` for native-support detection, `useEffect` for mount/create/destroy, a second `useEffect` calling `setOptions` on prop changes.
   - Non-native fallback: content renders as a plain DOM div when html-in-canvas isn't supported — never let the effect hard-fail the page.
7. **Export both the named function and a default export**, matching `Ripple`'s export shape.

## After scaffolding

- Hand off to `tune-shader-params` for feel/parameter iteration.
- Run `pond-perf-check` before considering the effect done — new render loops are the most common source of perf regressions on this page.
- If the effect's visual target came from a Figma design, coordinate with the `design-assets` agent on mapping tokens to the new `Options` fields rather than guessing values.
