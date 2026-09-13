"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export interface LotusOptions {
  /** URLs of the lotus leaf images to scatter across the surface. */
  sources?: string[];
  /** How many leaves float on the surface (1 to 16). */
  count?: number;
  /** Size of each leaf as a fraction of the shorter viewport side (0 to 1). */
  scale?: number;
  /** How strongly a touch nudges nearby leaves off their anchor. */
  pushStrength?: number;
  /** Radius in CSS pixels within which a touch affects leaves. */
  pushRadius?: number;
  /** How stiffly leaves spring back to their rooted position (higher snaps back faster). */
  stiffness?: number;
  /** How quickly the spring motion settles (higher settles faster, less bounce). */
  damping?: number;
  /** Strength of the soft drop shadow beneath each leaf (0 to 1). */
  shadow?: number;
}

export interface LotusElements {
  /** Canvas with layoutsubtree that hosts the HTML content. */
  source: HTMLCanvasElement;
  /** The element inside the source canvas that gets captured. */
  content: HTMLElement;
  /** Canvas the WebGL effect renders to. */
  output: HTMLCanvasElement;
}

export interface LotusInstance {
  /** Update effect options live. */
  setOptions: (options: LotusOptions) => void;
  /** Nudge leaves away from a point in CSS pixels relative to the element. */
  push: (x: number, y: number, strength?: number) => void;
  /** Re-read canvas size. Call when the element is resized. */
  resize: () => void;
  /** Stop the loop and release all GPU resources. */
  destroy: () => void;
}

const DEFAULTS: Required<LotusOptions> = {
  sources: ["/leaf%201.png", "/leaf%202.png"],
  count: 6,
  scale: 0.1,
  pushStrength: 1,
  pushRadius: 200,
  stiffness: 55,
  damping: 9,
  shadow: 0.4,
};

const MAX_LEAVES = 16;
const MAX_TEXTURES = 4;

type PaintableCanvas = HTMLCanvasElement & {
  onpaint?: (() => void) | null;
  requestPaint?: () => void;
};

type ElementImageContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x: number, y: number) => void;
};

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform sampler2D uLeaf0;
uniform sampler2D uLeaf1;
uniform sampler2D uLeaf2;
uniform sampler2D uLeaf3;
uniform vec2 uResolution;
uniform vec4 uLeaves[16];
uniform float uRotation[16];
uniform float uTexIndex[16];
uniform int uCount;
uniform float uShadow;
uniform float uHasContent;
uniform float uMaxX;

vec4 page (vec2 p) {
  p.x = clamp(p.x, 0.0005, uMaxX - 0.0005);
  p.y = clamp(p.y, 0.0005, 0.9995);
  return texture(uContent, p);
}

vec4 sampleTex (int idx, vec2 uv) {
  if (idx == 0) return texture(uLeaf0, uv);
  if (idx == 1) return texture(uLeaf1, uv);
  if (idx == 2) return texture(uLeaf2, uv);
  return texture(uLeaf3, uv);
}

vec4 sampleLeaf (vec2 frag, vec2 center, float half_, float rotation, int texIdx, out float alpha) {
  float c = cos(rotation);
  float s = sin(rotation);
  vec2 d = frag - center;
  vec2 local = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
  vec2 uv = local / (half_ * 2.0) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    alpha = 0.0;
    return vec4(0.0);
  }
  vec4 tex = sampleTex(texIdx, uv);
  alpha = tex.a;
  return tex;
}

void main () {
  vec2 pUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 frag = pUv * uResolution;

  vec3 baseCol = uHasContent < 0.5 ? vec3(0.0) : page(pUv).rgb;
  float baseAlpha = uHasContent < 0.5 ? 0.0 : 1.0;

  vec3 col = baseCol;
  float outAlpha = baseAlpha;

  for (int i = 0; i < 16; i++) {
    if (i >= uCount) break;
    vec4 leaf = uLeaves[i];
    vec2 center = leaf.xy;
    float half_ = max(leaf.z, 1.0) * 0.5;
    int texIdx = int(uTexIndex[i] + 0.5);

    float shadowAlpha;
    vec2 shadowCenter = center + vec2(half_ * 0.1, half_ * 0.16);
    sampleLeaf(frag, shadowCenter, half_, uRotation[i], texIdx, shadowAlpha);
    float sh = shadowAlpha * uShadow;
    col = mix(col, vec3(0.0), sh * 0.55);
    outAlpha = max(outAlpha, sh * 0.45);

    float alpha;
    vec4 tex = sampleLeaf(frag, center, half_, uRotation[i], texIdx, alpha);
    col = mix(col, tex.rgb, alpha);
    outAlpha = max(outAlpha, alpha);
  }

  if (uHasContent < 0.5) {
    outColor = vec4(col, outAlpha);
    return;
  }

  outColor = vec4(col, 1.0);
}`;

export function supportsHtmlInCanvas(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("canvas") as PaintableCanvas;
  const ctx = probe.getContext("2d") as ElementImageContext | null;
  return Boolean(
    ctx &&
    typeof ctx.drawElementImage === "function" &&
    typeof probe.requestPaint === "function",
  );
}

interface Leaf {
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  restAngle: number;
  angle: number;
  angularVelocity: number;
  swayPhase: number;
  swayFreq: number;
  size: number;
  texIndex: number;
}

function makeLeaves(
  count: number,
  width: number,
  height: number,
  textureCount: number,
): Leaf[] {
  const leaves: Leaf[] = [];
  for (let i = 0; i < count; i++) {
    const anchorX = width * (0.12 + Math.random() * 0.76);
    const anchorY = height * (0.12 + Math.random() * 0.76);
    const restAngle = Math.random() * Math.PI * 2;
    leaves.push({
      anchorX,
      anchorY,
      x: anchorX,
      y: anchorY,
      vx: 0,
      vy: 0,
      restAngle,
      angle: restAngle,
      angularVelocity: 0,
      swayPhase: Math.random() * Math.PI * 2,
      swayFreq: 0.15 + Math.random() * 0.15,
      size: 0.75 + Math.random() * 0.5,
      texIndex: Math.floor(Math.random() * Math.max(textureCount, 1)),
    });
  }
  return leaves;
}

export function createLotus(
  elements: LotusElements,
  options: LotusOptions = {},
): LotusInstance | null {
  const config = { ...DEFAULTS, ...options };
  const { source, content, output } = elements;

  const gl = output.getContext("webgl2", {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl || gl.isContextLost()) return null;

  const sourceCtx = source.getContext("2d") as ElementImageContext | null;
  const paintable = source as PaintableCanvas;
  const htmlInCanvas = Boolean(
    sourceCtx &&
    typeof sourceCtx.drawElementImage === "function" &&
    typeof paintable.requestPaint === "function",
  );

  let contentDirty = false;
  let wake = () => {};

  if (htmlInCanvas) {
    paintable.onpaint = () => {
      try {
        sourceCtx!.reset();
        sourceCtx!.drawElementImage!(content, 0, 0);
        contentDirty = true;
        wake();
      } catch {}
    };
  }

  function compile(type: number, text: string): WebGLShader {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, text);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error("Lotus shader error:", gl!.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, VERT);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const uniforms: Record<string, WebGLUniformLocation> = {};
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const info = gl.getActiveUniform(program, i)!;
    uniforms[info.name.replace("[0]", "")] = gl.getUniformLocation(
      program,
      info.name,
    )!;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const contentTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );

  const leafTextures: WebGLTexture[] = [];
  const leafReady: boolean[] = [];
  const sources = config.sources.slice(0, MAX_TEXTURES);
  const leafImages: HTMLImageElement[] = [];

  for (let i = 0; i < sources.length; i++) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    leafTextures.push(tex);
    leafReady.push(false);

    const img = new Image();
    img.decoding = "async";
    const index = i;
    img.onload = () => {
      if (destroyed) return;
      gl!.bindTexture(gl!.TEXTURE_2D, leafTextures[index]);
      gl!.texImage2D(
        gl!.TEXTURE_2D,
        0,
        gl!.RGBA,
        gl!.RGBA,
        gl!.UNSIGNED_BYTE,
        img,
      );
      leafReady[index] = true;
      start();
    };
    img.src = sources[index];
    leafImages.push(img);
  }

  function allReady(): boolean {
    return leafReady.length > 0 && leafReady.every(Boolean);
  }

  let leaves: Leaf[] = [];
  const leafData = new Float32Array(MAX_LEAVES * 4);
  const rotationData = new Float32Array(MAX_LEAVES);
  const texIndexData = new Float32Array(MAX_LEAVES);

  function rebuildLeaves() {
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    leaves = makeLeaves(
      Math.min(Math.max(config.count, 1), MAX_LEAVES),
      w,
      h,
      Math.max(sources.length, 1),
    );
  }

  function syncCanvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(output.clientWidth * dpr));
    const height = Math.max(1, Math.round(output.clientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
      rebuildLeaves();
    }
    if (htmlInCanvas) {
      const cssWidth = Math.max(1, Math.round(source.clientWidth));
      const cssHeight = Math.max(1, Math.round(source.clientHeight));
      if (source.width !== cssWidth * dpr || source.height !== cssHeight * dpr) {
        source.width = cssWidth * dpr;
        source.height = cssHeight * dpr;
      }
      paintable.requestPaint!();
    }
  }

  rebuildLeaves();
  syncCanvasSize();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, output.width, output.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  let contentMaxX = 1;

  function uploadContent() {
    if (!htmlInCanvas || !contentDirty) return;
    contentDirty = false;
    contentMaxX = Math.min(
      1,
      Math.max(0.05, content.clientWidth / Math.max(output.clientWidth, 1)),
    );
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.RGBA,
      gl!.RGBA,
      gl!.UNSIGNED_BYTE,
      source,
    );
  }

  const ANGULAR_DAMPING = 0.96;
  const SWAY_AMPLITUDE = 0.05;

  function step(delta: number, elapsed: number) {
    const stiffness = Math.max(config.stiffness, 1);
    const damping = Math.max(config.damping, 0);

    for (const leaf of leaves) {
      const dx = leaf.anchorX - leaf.x;
      const dy = leaf.anchorY - leaf.y;
      const ax = dx * stiffness - leaf.vx * damping;
      const ay = dy * stiffness - leaf.vy * damping;

      leaf.vx += ax * delta;
      leaf.vy += ay * delta;
      leaf.x += leaf.vx * delta;
      leaf.y += leaf.vy * delta;

      leaf.angularVelocity *= ANGULAR_DAMPING;
      const sway =
        Math.sin(elapsed * leaf.swayFreq + leaf.swayPhase) * SWAY_AMPLITUDE;
      leaf.angle +=
        (leaf.restAngle + sway - leaf.angle) * Math.min(delta * 3, 1) +
        leaf.angularVelocity * delta;
    }
  }

  function render(elapsed: number) {
    uploadContent();
    const dpr = output.width / Math.max(output.clientWidth, 1);
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    const baseSize = Math.min(w, h) * Math.max(config.scale, 0.02);

    const count = Math.min(leaves.length, MAX_LEAVES);
    for (let i = 0; i < count; i++) {
      const leaf = leaves[i];
      leafData[i * 4] = leaf.x * dpr;
      leafData[i * 4 + 1] = leaf.y * dpr;
      leafData[i * 4 + 2] = baseSize * leaf.size * dpr;
      leafData[i * 4 + 3] = 1;
      rotationData[i] = leaf.angle;
      texIndexData[i] = leaf.texIndex;
    }

    gl!.useProgram(program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.uniform1i(uniforms.uContent, 0);

    const textureUnitNames = ["uLeaf0", "uLeaf1", "uLeaf2", "uLeaf3"];
    for (let i = 0; i < MAX_TEXTURES; i++) {
      gl!.activeTexture(gl!.TEXTURE1 + i);
      const tex = leafTextures[i] ?? leafTextures[0];
      if (tex) gl!.bindTexture(gl!.TEXTURE_2D, tex);
      if (uniforms[textureUnitNames[i]]) {
        gl!.uniform1i(uniforms[textureUnitNames[i]], 1 + i);
      }
    }

    gl!.uniform2f(uniforms.uResolution, output.width, output.height);
    gl!.uniform4fv(uniforms.uLeaves, leafData);
    gl!.uniform1fv(uniforms.uRotation, rotationData);
    gl!.uniform1fv(uniforms.uTexIndex, texIndexData);
    gl!.uniform1i(uniforms.uCount, allReady() ? count : 0);
    gl!.uniform1f(uniforms.uShadow, Math.max(config.shadow, 0));
    gl!.uniform1f(uniforms.uHasContent, htmlInCanvas ? 1 : 0);
    gl!.uniform1f(uniforms.uMaxX, contentMaxX);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, output.width, output.height);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  function push(x: number, y: number, strength = 1) {
    if (reducedMotion) return;
    const radius = Math.max(config.pushRadius, 1);
    for (const leaf of leaves) {
      const dx = leaf.x - x;
      const dy = leaf.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius || dist < 0.001) continue;
      const falloff = 1 - dist / radius;
      const force = falloff * falloff * config.pushStrength * strength * 120;
      leaf.vx += (dx / dist) * force;
      leaf.vy += (dy / dist) * force;
      leaf.angularVelocity +=
        (dx > 0 ? 1 : -1) * falloff * config.pushStrength * strength * 0.8;
    }
    start();
  }

  let raf = 0;
  let startTime = performance.now();
  let lastTime = startTime;
  let destroyed = false;
  let running = false;
  let visible = true;

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;

  function frame(now: number) {
    if (destroyed) return;
    if (!visible) {
      running = false;
      return;
    }
    const delta = Math.min(Math.max((now - lastTime) / 1000, 0), 1 / 30);
    lastTime = now;
    const elapsed = (now - startTime) / 1000;
    if (reducedMotion) {
      render(elapsed);
      running = false;
      return;
    }
    step(delta, elapsed);
    render(elapsed);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  wake = start;
  start();

  function localPoint(event: PointerEvent): [number, number] {
    const rect = output.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function onPointerDown(event: PointerEvent) {
    const [x, y] = localPoint(event);
    push(x, y, 1);
  }

  content.addEventListener("pointerdown", onPointerDown, { passive: true });

  function onMotionChange() {
    reducedMotion = motionQuery.matches;
    if (reducedMotion) {
      for (const leaf of leaves) {
        leaf.x = leaf.anchorX;
        leaf.y = leaf.anchorY;
        leaf.vx = 0;
        leaf.vy = 0;
        leaf.angularVelocity = 0;
        leaf.angle = leaf.restAngle;
      }
    }
    start();
  }
  motionQuery.addEventListener("change", onMotionChange);

  const observer = new ResizeObserver(() => {
    syncCanvasSize();
    start();
  });
  observer.observe(output);
  observer.observe(content);

  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(output);

  return {
    setOptions(next) {
      if (
        !Object.entries(next).some(
          ([key, value]) => config[key as keyof LotusOptions] !== value,
        )
      )
        return;
      const countChanged =
        next.count !== undefined && next.count !== config.count;
      Object.assign(config, next);
      if (countChanged) rebuildLeaves();
      start();
    },
    push,
    resize() {
      syncCanvasSize();
      start();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      leafImages.forEach((img) => {
        img.onload = null;
      });
      content.removeEventListener("pointerdown", onPointerDown);
      observer.disconnect();
      intersection.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, output.width, output.height);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.deleteTexture(contentTexture);
      leafTextures.forEach((tex) => gl!.deleteTexture(tex));
      gl!.deleteProgram(program);
      gl!.deleteShader(vertexShader);
      gl!.deleteShader(fragmentShader);
      gl!.deleteBuffer(quad);
      if (htmlInCanvas) paintable.onpaint = null;
    },
  };
}

export interface LotusProps extends LotusOptions {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const emptySubscribe = () => () => {};

export function Lotus({ children, className, style, ...options }: LotusProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<LotusInstance | null>(null);
  const [initialOptions] = useState(options);
  const [failed, setFailed] = useState(false);

  const supported = useSyncExternalStore(
    emptySubscribe,
    supportsHtmlInCanvas,
    () => false,
  );
  const native = supported && !failed;

  useEffect(() => {
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    if (!source || !content || !output) return;
    instanceRef.current = createLotus(
      { source, content, output },
      initialOptions,
    );
    if (native && !instanceRef.current) setFailed(true);
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [initialOptions, native]);

  useEffect(() => {
    instanceRef.current?.setOptions(options);
  });

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <canvas
        ref={sourceRef}
        // @ts-expect-error experimental html-in-canvas attribute
        layoutsubtree="true"
        suppressHydrationWarning
        style={
          native
            ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
            : { display: "none" }
        }
      >
        {native ? (
          <div
            ref={contentRef}
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "auto",
            }}
          >
            {children}
          </div>
        ) : null}
      </canvas>
      {!native ? (
        <div
          ref={contentRef}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "auto",
          }}
        >
          {children}
        </div>
      ) : null}
      <canvas
        ref={outputRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

export default Lotus;
