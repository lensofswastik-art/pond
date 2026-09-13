"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export interface AlgaeOptions {
  /** URL of the algae SVG/image to tile as drifting layers. */
  src?: string;
  /** How many drifting copies to render (1 to 8). */
  layers?: number;
  /** How slowly layers drift. 1 is normal, lower is slower. */
  speed?: number;
  /** How far each layer wanders from its start point, in CSS pixels. */
  wander?: number;
  /** Size of each layer as a fraction of the shorter viewport side (0 to 2). */
  scale?: number;
  /** Overall opacity of the drifting layers (0 to 1). */
  opacity?: number;
}

export interface AlgaeElements {
  /** Canvas with layoutsubtree that hosts the HTML content. */
  source: HTMLCanvasElement;
  /** The element inside the source canvas that gets captured. */
  content: HTMLElement;
  /** Canvas the WebGL effect renders to. */
  output: HTMLCanvasElement;
}

export interface AlgaeInstance {
  /** Update effect options live. */
  setOptions: (options: AlgaeOptions) => void;
  /** Re-read canvas size. Call when the element is resized. */
  resize: () => void;
  /** Stop the loop and release all GPU resources. */
  destroy: () => void;
}

const DEFAULTS: Required<AlgaeOptions> = {
  src: "/algees.png",
  layers: 4,
  speed: 0.15,
  wander: 140,
  scale: 0.4,
  opacity: 0.6,
};

const MAX_LAYERS = 8;

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
uniform sampler2D uAlgae;
uniform vec2 uResolution;
uniform vec2 uAlgaeAspect;
uniform vec4 uLayers[8];
uniform float uRotation[8];
uniform int uCount;
uniform float uOpacity;
uniform float uHasContent;
uniform float uMaxX;

vec4 page (vec2 p) {
  p.x = clamp(p.x, 0.0005, uMaxX - 0.0005);
  p.y = clamp(p.y, 0.0005, 0.9995);
  return texture(uContent, p);
}

void main () {
  vec2 pUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 frag = pUv * uResolution;

  vec3 baseCol;
  if (uHasContent < 0.5) {
    baseCol = vec3(0.0);
  } else {
    baseCol = page(pUv).rgb;
  }

  vec4 accum = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    vec4 layer = uLayers[i];
    vec2 center = layer.xy;
    vec2 halfSize = vec2(max(layer.z, 1.0), max(layer.z, 1.0) * uAlgaeAspect.y / uAlgaeAspect.x) * 0.5;
    float c = cos(uRotation[i]);
    float s = sin(uRotation[i]);
    vec2 d = frag - center;
    vec2 local = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
    vec2 uv = local / (halfSize * 2.0) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    vec4 tex = texture(uAlgae, uv);
    float a = tex.a * layer.w * uOpacity;
    accum = accum * (1.0 - a) + vec4(tex.rgb, 1.0) * a;
  }

  if (uHasContent < 0.5) {
    outColor = accum;
    return;
  }

  vec3 col = mix(baseCol, accum.rgb, accum.a);
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

interface DriftLayer {
  originX: number;
  originY: number;
  phaseX: number;
  phaseY: number;
  phaseR: number;
  freqX: number;
  freqY: number;
  freqR: number;
  size: number;
  alpha: number;
}

function makeLayers(count: number, width: number, height: number): DriftLayer[] {
  const layers: DriftLayer[] = [];
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const edge = i % 4;
    const along = (i / count + Math.random() * 0.3) % 1;
    let x: number;
    let y: number;
    if (edge === 0) {
      x = along * width;
      y = height * 0.05;
    } else if (edge === 1) {
      x = width * 0.95;
      y = along * height;
    } else if (edge === 2) {
      x = along * width;
      y = height * 0.95;
    } else {
      x = width * 0.05;
      y = along * height;
    }
    edges.push([x, y]);
  }
  for (let i = 0; i < count; i++) {
    const [x, y] = edges[i];
    layers.push({
      originX: x,
      originY: y,
      phaseX: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      phaseR: Math.random() * Math.PI * 2,
      freqX: 0.05 + Math.random() * 0.05,
      freqY: 0.04 + Math.random() * 0.05,
      freqR: 0.02 + Math.random() * 0.03,
      size: 0.75 + Math.random() * 0.5,
      alpha: 0.6 + Math.random() * 0.4,
    });
  }
  return layers;
}

export function createAlgae(
  elements: AlgaeElements,
  options: AlgaeOptions = {},
): AlgaeInstance | null {
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
      console.error("Algae shader error:", gl!.getShaderInfoLog(shader));
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

  const algaeTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, algaeTexture);
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

  let algaeAspectX = 1;
  let algaeAspectY = 1;
  let algaeReady = false;

  const algaeImage = new Image();
  algaeImage.decoding = "async";
  algaeImage.onload = () => {
    if (destroyed) return;
    gl!.bindTexture(gl!.TEXTURE_2D, algaeTexture);
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.RGBA,
      gl!.RGBA,
      gl!.UNSIGNED_BYTE,
      algaeImage,
    );
    const iw = algaeImage.naturalWidth || 1;
    const ih = algaeImage.naturalHeight || 1;
    if (iw >= ih) {
      algaeAspectX = 1;
      algaeAspectY = ih / iw;
    } else {
      algaeAspectX = iw / ih;
      algaeAspectY = 1;
    }
    algaeReady = true;
    start();
  };
  algaeImage.src = config.src;

  let layers: DriftLayer[] = [];
  const layerData = new Float32Array(MAX_LAYERS * 4);
  const rotationData = new Float32Array(MAX_LAYERS);

  function rebuildLayers() {
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    layers = makeLayers(Math.min(Math.max(config.layers, 1), MAX_LAYERS), w, h);
  }

  function syncCanvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(output.clientWidth * dpr));
    const height = Math.max(1, Math.round(output.clientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
      rebuildLayers();
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

  rebuildLayers();
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

  function render(elapsed: number) {
    uploadContent();
    const dpr = output.width / Math.max(output.clientWidth, 1);
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    const baseSize = Math.max(w, h) * Math.max(config.scale, 0.05) * 1.6;
    const speed = Math.max(config.speed, 0);

    const count = Math.min(layers.length, MAX_LAYERS);
    for (let i = 0; i < count; i++) {
      const layer = layers[i];
      const t = elapsed * speed;
      const x =
        layer.originX + Math.sin(t * layer.freqX + layer.phaseX) * config.wander;
      const y =
        layer.originY + Math.cos(t * layer.freqY + layer.phaseY) * config.wander;
      const rotation = Math.sin(t * layer.freqR + layer.phaseR) * 0.3;
      layerData[i * 4] = x * dpr;
      layerData[i * 4 + 1] = y * dpr;
      layerData[i * 4 + 2] = baseSize * layer.size * dpr;
      layerData[i * 4 + 3] = layer.alpha;
      rotationData[i] = rotation;
    }

    gl!.useProgram(program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.uniform1i(uniforms.uContent, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, algaeTexture);
    gl!.uniform1i(uniforms.uAlgae, 1);
    gl!.uniform2f(uniforms.uResolution, output.width, output.height);
    gl!.uniform2f(uniforms.uAlgaeAspect, algaeAspectX, algaeAspectY);
    gl!.uniform4fv(uniforms.uLayers, layerData);
    gl!.uniform1fv(uniforms.uRotation, rotationData);
    gl!.uniform1i(uniforms.uCount, algaeReady ? count : 0);
    gl!.uniform1f(uniforms.uOpacity, Math.max(config.opacity, 0));
    gl!.uniform1f(uniforms.uHasContent, htmlInCanvas ? 1 : 0);
    gl!.uniform1f(uniforms.uMaxX, contentMaxX);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, output.width, output.height);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  let raf = 0;
  let startTime = performance.now();
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
    const elapsed = (now - startTime) / 1000;
    if (reducedMotion) {
      render(0);
      running = false;
      return;
    }
    render(elapsed);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  wake = start;
  start();

  function onMotionChange() {
    reducedMotion = motionQuery.matches;
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
          ([key, value]) => config[key as keyof AlgaeOptions] !== value,
        )
      )
        return;
      const layersChanged =
        next.layers !== undefined && next.layers !== config.layers;
      const srcChanged = next.src !== undefined && next.src !== config.src;
      Object.assign(config, next);
      if (layersChanged) rebuildLayers();
      if (srcChanged) {
        algaeReady = false;
        algaeImage.src = config.src;
      }
      start();
    },
    resize() {
      syncCanvasSize();
      start();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      algaeImage.onload = null;
      observer.disconnect();
      intersection.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, output.width, output.height);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.deleteTexture(contentTexture);
      gl!.deleteTexture(algaeTexture);
      gl!.deleteProgram(program);
      gl!.deleteShader(vertexShader);
      gl!.deleteShader(fragmentShader);
      gl!.deleteBuffer(quad);
      if (htmlInCanvas) paintable.onpaint = null;
    },
  };
}

export interface AlgaeProps extends AlgaeOptions {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const emptySubscribe = () => () => {};

export function Algae({ children, className, style, ...options }: AlgaeProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<AlgaeInstance | null>(null);
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
    instanceRef.current = createAlgae(
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

export default Algae;
