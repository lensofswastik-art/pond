"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createRectCache } from "../rect-cache";

export interface FlowersOptions {
  /** URL of the flower image to scatter across the surface. */
  src?: string;
  /** How many flowers float on the surface (1 to 16). */
  count?: number;
  /** Size of each flower as a fraction of the shorter viewport side (0 to 1). */
  scale?: number;
  /** How strongly a touch pushes nearby flowers away. */
  pushStrength?: number;
  /** Radius in CSS pixels within which a touch affects flowers. */
  pushRadius?: number;
  /** Strength of the soft drop shadow beneath each flower (0 to 1). */
  shadow?: number;
}

export interface FlowersElements {
  /** Canvas with layoutsubtree that hosts the HTML content. */
  source: HTMLCanvasElement;
  /** The element inside the source canvas that gets captured. */
  content: HTMLElement;
  /** Canvas the WebGL effect renders to. */
  output: HTMLCanvasElement;
}

export interface FlowersInstance {
  /** Update effect options live. */
  setOptions: (options: FlowersOptions) => void;
  /** Push flowers away from a point in CSS pixels relative to the element. */
  push: (x: number, y: number, strength?: number) => void;
  /** Re-read canvas size. Call when the element is resized. */
  resize: () => void;
  /** Stop the loop and release all GPU resources. */
  destroy: () => void;
}

const DEFAULTS: Required<FlowersOptions> = {
  src: "/flower.png",
  count: 10,
  scale: 0.04,
  pushStrength: 1,
  pushRadius: 220,
  shadow: 0.45,
};

const MAX_FLOWERS = 16;

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
uniform sampler2D uFlower;
uniform vec2 uResolution;
uniform vec4 uFlowers[16];
uniform float uRotation[16];
uniform int uCount;
uniform float uShadow;
uniform float uHasContent;
uniform float uMaxX;

vec4 page (vec2 p) {
  p.x = clamp(p.x, 0.0005, uMaxX - 0.0005);
  p.y = clamp(p.y, 0.0005, 0.9995);
  return texture(uContent, p);
}

vec4 sampleFlower (vec2 frag, vec2 center, float half_, float rotation, out float alpha) {
  float c = cos(rotation);
  float s = sin(rotation);
  vec2 d = frag - center;
  vec2 local = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
  vec2 uv = local / (half_ * 2.0) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    alpha = 0.0;
    return vec4(0.0);
  }
  vec4 tex = texture(uFlower, uv);
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
    vec4 flower = uFlowers[i];
    vec2 center = flower.xy;
    float half_ = max(flower.z, 1.0) * 0.5;

    float shadowAlpha;
    vec2 shadowCenter = center + vec2(half_ * 0.14, half_ * 0.22);
    sampleFlower(frag, shadowCenter, half_, uRotation[i], shadowAlpha);
    float sh = shadowAlpha * uShadow;
    col = mix(col, vec3(0.0), sh * (1.0 - outAlpha * 0.0) * 0.6);
    outAlpha = max(outAlpha, sh * 0.5);

    float alpha;
    vec4 tex = sampleFlower(frag, center, half_, uRotation[i], alpha);
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

interface Flower {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  size: number;
}

function makeFlowers(count: number, width: number, height: number): Flower[] {
  const flowers: Flower[] = [];
  for (let i = 0; i < count; i++) {
    flowers.push({
      x: width * (0.1 + Math.random() * 0.8),
      y: height * (0.1 + Math.random() * 0.8),
      vx: 0,
      vy: 0,
      angle: Math.random() * Math.PI * 2,
      angularVelocity: 0,
      size: 0.7 + Math.random() * 0.6,
    });
  }
  return flowers;
}

export function createFlowers(
  elements: FlowersElements,
  options: FlowersOptions = {},
): FlowersInstance | null {
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
      console.error("Flowers shader error:", gl!.getShaderInfoLog(shader));
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

  const flowerTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, flowerTexture);
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

  let flowerReady = false;

  const flowerImage = new Image();
  flowerImage.decoding = "async";
  flowerImage.onload = () => {
    if (destroyed) return;
    gl!.bindTexture(gl!.TEXTURE_2D, flowerTexture);
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.RGBA,
      gl!.RGBA,
      gl!.UNSIGNED_BYTE,
      flowerImage,
    );
    flowerReady = true;
    start();
  };
  flowerImage.src = config.src;

  let flowers: Flower[] = [];
  const flowerData = new Float32Array(MAX_FLOWERS * 4);
  const rotationData = new Float32Array(MAX_FLOWERS);

  function rebuildFlowers() {
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    flowers = makeFlowers(
      Math.min(Math.max(config.count, 1), MAX_FLOWERS),
      w,
      h,
    );
  }

  function syncCanvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(output.clientWidth * dpr));
    const height = Math.max(1, Math.round(output.clientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
      rebuildFlowers();
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

  rebuildFlowers();
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

  const DAMPING = 0.94;
  const ANGULAR_DAMPING = 0.94;
  const MARGIN = 0.08;
  const REST_SPEED_SQ = 0.05;

  function step(delta: number): boolean {
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    let moving = false;

    for (const flower of flowers) {
      flower.vx *= DAMPING;
      flower.vy *= DAMPING;
      flower.angularVelocity *= ANGULAR_DAMPING;

      flower.x += flower.vx * delta;
      flower.y += flower.vy * delta;
      flower.angle += flower.angularVelocity * delta;

      const minX = w * MARGIN;
      const maxX = w * (1 - MARGIN);
      const minY = h * MARGIN;
      const maxY = h * (1 - MARGIN);
      if (flower.x < minX) {
        flower.x = minX;
        flower.vx = Math.abs(flower.vx) * 0.4;
      } else if (flower.x > maxX) {
        flower.x = maxX;
        flower.vx = -Math.abs(flower.vx) * 0.4;
      }
      if (flower.y < minY) {
        flower.y = minY;
        flower.vy = Math.abs(flower.vy) * 0.4;
      } else if (flower.y > maxY) {
        flower.y = maxY;
        flower.vy = -Math.abs(flower.vy) * 0.4;
      }

      if (
        flower.vx * flower.vx + flower.vy * flower.vy > REST_SPEED_SQ ||
        Math.abs(flower.angularVelocity) > 0.01
      ) {
        moving = true;
      }
    }
    return moving;
  }

  function render(elapsed: number) {
    uploadContent();
    const dpr = output.width / Math.max(output.clientWidth, 1);
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    const baseSize = Math.min(w, h) * Math.max(config.scale, 0.02);

    const count = Math.min(flowers.length, MAX_FLOWERS);
    for (let i = 0; i < count; i++) {
      const flower = flowers[i];
      flowerData[i * 4] = flower.x * dpr;
      flowerData[i * 4 + 1] = flower.y * dpr;
      flowerData[i * 4 + 2] = baseSize * flower.size * dpr;
      flowerData[i * 4 + 3] = 1;
      rotationData[i] = flower.angle;
    }

    gl!.useProgram(program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.uniform1i(uniforms.uContent, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, flowerTexture);
    gl!.uniform1i(uniforms.uFlower, 1);
    gl!.uniform2f(uniforms.uResolution, output.width, output.height);
    gl!.uniform4fv(uniforms.uFlowers, flowerData);
    gl!.uniform1fv(uniforms.uRotation, rotationData);
    gl!.uniform1i(uniforms.uCount, flowerReady ? count : 0);
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
    for (const flower of flowers) {
      const dx = flower.x - x;
      const dy = flower.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius || dist < 0.001) continue;
      const falloff = 1 - dist / radius;
      const force =
        falloff * falloff * config.pushStrength * strength * 260;
      flower.vx += (dx / dist) * force;
      flower.vy += (dy / dist) * force;
      flower.angularVelocity +=
        (dx > 0 ? 1 : -1) * falloff * config.pushStrength * strength * 1.2;
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
    const moving = step(delta);
    render(elapsed);
    if (!moving) {
      running = false;
      return;
    }
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

  const rectCache = createRectCache(output);

  function localPoint(event: PointerEvent): [number, number] {
    const rect = rectCache.current;
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
      for (const flower of flowers) {
        flower.vx = 0;
        flower.vy = 0;
        flower.angularVelocity = 0;
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
          ([key, value]) => config[key as keyof FlowersOptions] !== value,
        )
      )
        return;
      const countChanged =
        next.count !== undefined && next.count !== config.count;
      const srcChanged = next.src !== undefined && next.src !== config.src;
      Object.assign(config, next);
      if (countChanged) rebuildFlowers();
      if (srcChanged) {
        flowerReady = false;
        flowerImage.src = config.src;
      }
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
      rectCache.destroy();
      flowerImage.onload = null;
      content.removeEventListener("pointerdown", onPointerDown);
      observer.disconnect();
      intersection.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, output.width, output.height);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.deleteTexture(contentTexture);
      gl!.deleteTexture(flowerTexture);
      gl!.deleteProgram(program);
      gl!.deleteShader(vertexShader);
      gl!.deleteShader(fragmentShader);
      gl!.deleteBuffer(quad);
      if (htmlInCanvas) paintable.onpaint = null;
    },
  };
}

export interface FlowersProps extends FlowersOptions {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const emptySubscribe = () => () => {};

export function Flowers({
  children,
  className,
  style,
  ...options
}: FlowersProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<FlowersInstance | null>(null);
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
    instanceRef.current = createFlowers(
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

export default Flowers;
