---
name: pond-perf-check
description: Checklist for verifying a canvasui WebGL effect change doesn't hurt frame rate, GPU load, or idle CPU on the pond page. Use before considering any shader/effect change done, especially changes to resolution, iteration counts, or particle/ripple caps — this page runs continuously for anonymous public visitors.
---

# Pond performance check

The pond is a public, always-on interactive page — assume low-end devices, long idle sessions, and visitors who never stop scrolling/clicking. A perf regression here is a regression for everyone, silently.

## Checklist

1. **Idle loop actually stops.** Confirm the RAF loop returns early and does not call `requestAnimationFrame` again once ripples/motion settle (see the `running = false; return;` branches in `Ripple.tsx`'s `frame()`). An effect that renders every frame forever, even at rest, burns battery/GPU for zero visual gain.
2. **Off-screen pause works.** The `IntersectionObserver` must actually stop rendering when the effect scrolls out of view — verify by scrolling the effect off-screen and checking the RAF loop halts (e.g. via a quick `console.log` in `frame()`, removed after checking).
3. **`prefers-reduced-motion` is honored.** With the OS setting on, ambient/idle animation must stop; check the `motionQuery` handling clears active ripples/particles rather than just skipping new ones.
4. **Resolution/iteration changes are justified.** For `Liquid`, `simResolution`/`dyeResolution`/`pressureIterations` are the primary perf levers — any increase should have a visible reason. For `Ripple`, `MAX_RIPPLES` (currently 12) and the per-ripple shader loop cost scale linearly; don't raise the cap without checking frame time.
5. **DPR is capped.** Both components cap device pixel ratio at 2 (`Math.min(window.devicePixelRatio || 1, 2)`) — keep this when adding new effects; uncapped DPR on high-density displays tanks fill-rate for no perceptible gain.
6. **Measure, don't guess.** Use Chrome/Playwright devtools performance panel or the browser's built-in FPS meter while actively interacting (rapid clicks for Ripple, continuous pointer drag for Liquid) — the worst case is sustained interaction, not a single click.
7. **WebGL resource cleanup verified.** If multiple effect instances can mount/unmount (e.g. route changes, conditional rendering), confirm `destroy()` is actually called and releases textures/programs/buffers — leaked GL resources accumulate across navigation in a long-lived session.
8. **No console errors/warnings** from shader compilation or context state — check devtools console after interacting, not just on load.

## How to measure

Prefer the Playwright MCP (`browser_navigate`, `browser_click`, `browser_console_messages`, `browser_evaluate` for a quick `performance.now()`-based FPS sample) over asking the user to check manually — this project already has Playwright MCP output artifacts (`.playwright-mcp/`) from prior sessions, so it's the established verification path here.

Screenshots and console/page dumps taken for verification are throwaway artifacts, not project deliverables — `.playwright-mcp/` and any root-level `.png`/`.jpg`/`.jpeg` are gitignored. Never `git add -f` them; if a screenshot needs to be shared with the user, send it directly rather than committing it.
