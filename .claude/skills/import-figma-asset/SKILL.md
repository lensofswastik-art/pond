---
name: import-figma-asset
description: Pull a design asset, token, or shader/motion spec from Figma via the Figma MCP and land it correctly in the pond codebase (public/ assets, Tailwind tokens, or WebGL effect props). Use when the user references a Figma file, a figma.com URL, or says they've designed something to bring in.
---

# Import a Figma asset into the pond

The user designs custom visual assets in Figma and improvises the pond's look iteratively. This skill routes a Figma design into the right place in this Next.js codebase.

## Mandatory: load the Figma skill for the operation first

Per the Figma MCP server's own instructions, never call its tools directly:

- Reading a design → load `figma:figma-design-to-code` before `get_design_context`
- Any write/programmatic action → load `figma:figma-use` before `use_figma`
- A shader effect/fill designed in Figma → load `figma:figma-shaders` before `create_shader`/`get_shader`/`get_shader_effect`/`get_shader_fill`
- Pushing this app's UI back into Figma → load `figma:figma-generate-design`

## Steps

1. **Confirm the target** — ask which Figma file/frame/node if not given a URL or if "whatever I just made" is ambiguous with multiple recent changes.
2. **Load the matching figma: skill(s)** above, then read the design (`get_design_context`, `get_screenshot`, `get_metadata`, or `get_shader`/`get_shader_effect` for a shader).
3. **Classify what was pulled**, then route it:
   - **Static image/icon** → export via the asset download flow, save under `public/`, reference by path from `app/page.tsx` or the relevant component. Keep it optimized — this page already runs a live WebGL loop, don't add asset weight competing for GPU/network.
   - **Color/spacing/type token** → decide reused vs. one-off: reused tokens go into `app/globals.css` / the Tailwind v4 theme (this project uses `components.json` shadcn config); one-off values can stay inline.
   - **Shader/motion spec** → do not translate this into GLSL yourself if the mapping isn't obvious. Summarize the Figma shader/motion intent in plain terms (e.g. "radial distortion pulsing outward, fast decay") and either hand off to the `webgl-effects` agent to map it onto existing `RippleOptions`/`LiquidOptions` uniforms, or propose new uniforms if nothing existing covers it.
4. **Never leave Figma URLs/node IDs in code comments** unless the user explicitly wants them for traceability — they rot and this codebase stays clean of external references otherwise.
5. **Verify in the browser** after landing the asset — load the dev server and visually confirm placement/color/behavior before calling it done.

## This is not standard Next.js

Check `node_modules/next/dist/docs/` (per `AGENTS.md`) before assuming standard conventions for static asset handling, image optimization, or public path resolution — this fork may differ.
