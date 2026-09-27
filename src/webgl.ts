/**
 * grabfold/webgl — a page that really curls.
 *
 * The DOM renderer folds a page flat along its crease and paints the bend on
 * with shading. This one bends it: the sheet is a mesh, wrapped round a
 * cylinder lying along the very same crease, lit, and drawn on the GPU. What
 * the page shows is taken from an image of it — a canvas, an `<img>`, an
 * `ImageBitmap` — so it suits books whose pages are pictures anyway: a PDF
 * rendered with pdf.js, a comic, a photo album, a catalogue.
 *
 * ```ts
 * import { Grabfold } from "grabfold";
 * import { webglFold } from "grabfold/webgl";
 *
 * new Grabfold(element, {
 *   sheets,
 *   render: (slot, page) => slot.append(canvasFor(page)),
 *   foldRenderer: webglFold({ texture: (page) => canvasFor(page) }),
 * });
 * ```
 *
 * Only the leaf that is turning is drawn here. The pages lying open are still
 * the book's own elements, and so is every page's content: it is moved onto
 * the leaf, out of sight, for the length of the turn, and back again after,
 * exactly as with the DOM renderer. Where WebGL is not available the DOM
 * renderer is used instead, and nothing else changes.
 *
 * The curl is exact where it matters: a point of the sheet far enough past
 * the crease lands precisely where the flat fold would put it, so the page
 * comes down square on the facing page and hands over to it seamlessly.
 */

import { foldDepth, foldGeometry, type Point } from "./geometry.ts";
import type { PageRef } from "./model.ts";
import {
  FoldingSheet,
  placeBand,
  polygon,
  type Shading,
  type SheetFrame,
  type SheetRenderer,
} from "./sheet.ts";

type Source = TexImageSource;
type Maybe<T> = T | null | undefined;

export interface WebGLFoldOptions {
  /**
   * An image of a page, the way it reads: the book stretches it over the
   * page. Return a promise if it has to be drawn or loaded first, and the
   * leaf is shown as blank paper until it resolves.
   */
  texture: (page: PageRef) => Maybe<Source> | Promise<Maybe<Source>>;
  /** How tight the curl is at its tightest, as a share of a page's width. Default 0.14. */
  radius?: number;
  /** How finely the sheet is divided each way. Default 48. */
  segments?: number;
  /** The most device pixels drawn per CSS pixel. Default 2. */
  maxPixelRatio?: number;
  /** How many page images are kept on the GPU. Default 12. */
  cache?: number;
}

/* ------------------------------------------------------------------ curl */

export interface Curl {
  /** A point on the crease, and the unit normal pointing away from the part carried over. */
  through: Point;
  normal: Point;
  /** The cylinder's radius, in pixels; 0 folds flat. */
  radius: number;
}

export interface CurledPoint {
  x: number;
  y: number;
  /** Height off the page, towards the reader. */
  z: number;
  /** How far round the cylinder: 0 flat, π lying face down on the far side. */
  angle: number;
}

/**
 * Where a point of the sheet ends up, curled.
 *
 * The cylinder's axis sits a quarter-turn's length back from the crease, so a
 * point that has gone all the way round lands exactly where folding flat
 * about the crease would put it — the curl and the fold agree on everything
 * but the bend. The shader does the same sums; this is them in JavaScript,
 * for testing.
 */
export function curlPoint(point: Point, curl: Curl): CurledPoint {
  const { through, normal, radius } = curl;
  const side = (point.x - through.x) * normal.x + (point.y - through.y) * normal.y;
  const around = -side + (Math.PI * radius) / 2;
  if (around <= 0) return { x: point.x, y: point.y, z: 0, angle: 0 };
  if (radius <= 0) {
    return { x: point.x + normal.x * 2 * around, y: point.y + normal.y * 2 * around, z: 0, angle: Math.PI };
  }
  if (around < Math.PI * radius) {
    const angle = around / radius;
    const back = around - radius * Math.sin(angle);
    return {
      x: point.x + normal.x * back,
      y: point.y + normal.y * back,
      z: radius * (1 - Math.cos(angle)),
      angle,
    };
  }
  const back = 2 * around - Math.PI * radius;
  return { x: point.x + normal.x * back, y: point.y + normal.y * back, z: 2 * radius, angle: Math.PI };
}

/* --------------------------------------------------------------- shaders */

const VERTEX = `
attribute vec2 aPage;
uniform vec2 uSize;
uniform vec2 uThrough;
uniform vec2 uNormal;
uniform float uRadius;
uniform vec4 uView;
uniform vec2 uEye;
uniform float uPerspective;
varying vec2 vPage;
varying vec3 vNormal;
const float PI = 3.14159265;
void main() {
  vec2 p = aPage * uSize;
  float around = -dot(p - uThrough, uNormal) + PI * uRadius * 0.5;
  vec3 at = vec3(p, 0.0);
  vec3 n = vec3(0.0, 0.0, 1.0);
  if (around > 0.0) {
    if (uRadius < 0.001) {
      at.xy = p + uNormal * 2.0 * around;
      n = vec3(0.0, 0.0, -1.0);
    } else if (around < PI * uRadius) {
      float angle = around / uRadius;
      at.xy = p + uNormal * (around - uRadius * sin(angle));
      at.z = uRadius * (1.0 - cos(angle));
      n = vec3(uNormal * sin(angle), cos(angle));
    } else {
      at.xy = p + uNormal * (2.0 * around - PI * uRadius);
      at.z = 2.0 * uRadius;
      n = vec3(0.0, 0.0, -1.0);
    }
  }
  // A touch of perspective about the spine: what lifts towards the reader
  // grows, the way the DOM board does.
  vec2 xy = uEye + (at.xy - uEye) / (1.0 - at.z * uPerspective);
  vec2 clip = (xy - uView.xy) / uView.zw * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, -at.z / (uSize.x * 4.0), 1.0);
  vPage = aPage;
  vNormal = n;
}
`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uHasFront;
uniform float uHasBack;
uniform vec3 uPaper;
uniform vec3 uLiftColor;
uniform float uOrient;
uniform float uSpineLeft;
uniform float uGutter;
uniform float uShadow;
uniform float uLift;
uniform float uDepth;
varying vec2 vPage;
varying vec3 vNormal;
vec2 orient(vec2 uv) {
  if (uOrient > 1.5) return uv.yx;
  if (uOrient > 0.5) return vec2(1.0 - uv.x, uv.y);
  return uv;
}
void main() {
  bool front = vNormal.z >= 0.0;
  // The far face is read the other way round.
  vec2 uv = front ? vPage : vec2(1.0 - vPage.x, vPage.y);
  vec4 image = front
    ? (uHasFront > 0.5 ? texture2D(uFront, orient(uv)) : vec4(0.0))
    : (uHasBack > 0.5 ? texture2D(uBack, orient(uv)) : vec4(0.0));
  // Premultiplied: whatever the image leaves clear is paper.
  vec3 colour = image.rgb + uPaper * (1.0 - image.a);

  // Into the binding, as on the book's own pages.
  float fromSpine = uSpineLeft > 0.5 ? vPage.x : 1.0 - vPage.x;
  float gutter = fromSpine < 0.08
    ? mix(1.0, 0.34, fromSpine / 0.08)
    : (fromSpine < 0.24 ? mix(0.34, 0.0, (fromSpine - 0.08) / 0.16) : 0.0);
  colour *= 1.0 - uGutter * gutter;

  // Off the table and towards the light, as the DOM renderer does it.
  if (!front) colour = mix(colour, uLiftColor, uLift * uDepth);

  vec3 n = normalize(front ? vNormal : -vNormal);
  vec3 light = normalize(vec3(-0.35, -0.45, 1.0));
  float lit = clamp(dot(n, light) / light.z, 0.3, 1.12);
  float shade = 1.0 + (lit - 1.0) * (uShadow / 0.4);
  gl_FragColor = vec4(colour * shade, 1.0);
}
`;

/* ----------------------------------------------------------------- sheet */

interface Cached {
  texture: WebGLTexture | null;
  used: number;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("grabfold/webgl: could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`grabfold/webgl: ${gl.getShaderInfoLog(shader) ?? "shader failed"}`);
  }
  return shader;
}

const colours = new Map<string, [number, number, number]>();

/** Reads any CSS colour as 0–1 RGB. */
function parseColour(doc: Document, value: string, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const known = colours.get(value);
  if (known) return known;
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context || !value) return fallback;
  context.fillStyle = "#000";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  const colour: [number, number, number] = [r / 255, g / 255, b / 255];
  colours.set(value, colour);
  return colour;
}

const pageKey = (page: PageRef) =>
  page.kind === "cover" ? `cover:${page.side}:${page.face}` : `${page.kind}:${page.sheet}`;

class CurlSheet implements SheetRenderer {
  readonly root: HTMLDivElement;
  readonly restingSlot: HTMLDivElement;
  readonly turnedSlot: HTMLDivElement;

  private readonly doc: Document;
  private readonly options: Required<Omit<WebGLFoldOptions, "texture">> & Pick<WebGLFoldOptions, "texture">;
  private readonly canvas: HTMLCanvasElement;
  private readonly cast: HTMLDivElement;
  private readonly castBand: HTMLSpanElement;
  private readonly keep: HTMLDivElement;
  private gl: WebGLRenderingContext;
  private program!: WebGLProgram;
  private buffers!: { vertices: WebGLBuffer; indices: WebGLBuffer; count: number; wide: boolean };
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly cache = new Map<string, Cached>();
  private shading: Shading;
  private faces: { resting: string | null; turned: string | null } = { resting: null, turned: null };
  private spine: "left" | "right" = "left";
  private orient = 0;
  private box = { width: 0, height: 0, pad: 0 };
  private last: SheetFrame | null = null;
  private tick = 0;
  private lost = false;

  static create(doc: Document, shading: Shading, options: WebGLFoldOptions): CurlSheet | null {
    const canvas = doc.createElement("canvas");
    const attributes = { alpha: true, premultipliedAlpha: true, antialias: true };
    const gl = (canvas.getContext("webgl2", attributes) ??
      canvas.getContext("webgl", attributes)) as WebGLRenderingContext | null;
    if (!gl) return null;
    try {
      return new CurlSheet(doc, shading, options, canvas, gl);
    } catch {
      return null;
    }
  }

  private constructor(
    doc: Document,
    shading: Shading,
    options: WebGLFoldOptions,
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
  ) {
    this.doc = doc;
    this.shading = shading;
    this.options = { radius: 0.14, segments: 48, maxPixelRatio: 2, cache: 12, ...options };
    this.canvas = canvas;
    this.gl = gl;

    this.root = doc.createElement("div");
    this.root.className = "grabfold-sheet grabfold-curl";
    this.root.setAttribute("aria-hidden", "true");
    Object.assign(this.root.style, {
      position: "absolute",
      top: "0",
      zIndex: "3",
      pointerEvents: "none",
      display: "none",
    });

    this.cast = doc.createElement("div");
    this.cast.className = "grabfold-cast";
    Object.assign(this.cast.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    this.castBand = doc.createElement("span");
    this.castBand.className = "grabfold-band";
    Object.assign(this.castBand.style, { position: "absolute", left: "0", top: "0", transformOrigin: "0 0" });
    this.cast.append(this.castBand);

    Object.assign(canvas.style, { position: "absolute", pointerEvents: "none" });
    canvas.className = "grabfold-curl-canvas";

    // The pages themselves, kept laid out at their size but out of sight for
    // the turn: the leaf is drawn from their images.
    const keep = doc.createElement("div");
    keep.className = "grabfold-curl-pages";
    // Invisible but there: during a peek, the part of the page still lying
    // flat can be clicked, as in the DOM renderer.
    Object.assign(keep.style, { position: "absolute", inset: "0", opacity: "0" });
    this.keep = keep;
    const slot = () => {
      const el = doc.createElement("div");
      el.className = "grabfold-slot";
      Object.assign(el.style, { position: "absolute", inset: "0" });
      return el;
    };
    this.restingSlot = slot();
    this.turnedSlot = slot();
    keep.append(this.restingSlot, this.turnedSlot);

    this.root.append(keep, this.cast, canvas);
    this.setup();

    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.uniforms.clear();
      this.cache.clear();
      this.setup();
      this.setFaces(this.pageOf(this.faces.resting), this.pageOf(this.faces.turned), this.spine);
    });
  }

  private pageOf(key: string | null): PageRef | null {
    if (!key) return null;
    const [kind, value, face] = key.split(":");
    if (kind === "cover") {
      return { kind: "cover", side: value === "back" ? "back" : "front", face: face === "outside" ? "outside" : "inside" };
    }
    return { kind: kind === "back" ? "back" : "front", sheet: Number(value) };
  }

  private setup(): void {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error("grabfold/webgl: could not create a program");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`grabfold/webgl: ${gl.getProgramInfoLog(program) ?? "link failed"}`);
    }
    this.program = program;

    // A grid over the page, 0 to 1 each way.
    const n = Math.max(4, Math.round(this.options.segments));
    const vertices = new Float32Array((n + 1) * (n + 1) * 2);
    for (let row = 0; row <= n; row += 1) {
      for (let column = 0; column <= n; column += 1) {
        const at = (row * (n + 1) + column) * 2;
        vertices[at] = column / n;
        vertices[at + 1] = row / n;
      }
    }
    const wide = (n + 1) * (n + 1) > 65535;
    const indices = wide ? new Uint32Array(n * n * 6) : new Uint16Array(n * n * 6);
    let index = 0;
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const a = row * (n + 1) + column;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        indices.set([a, b, c, b, d, c], index);
        index += 6;
      }
    }
    const vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    if (wide) gl.getExtension("OES_element_index_uint");
    this.buffers = { vertices: vertexBuffer, indices: indexBuffer, count: indices.length, wide };

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name) ?? null;
  }

  setShading(shading: Shading): void {
    this.shading = shading;
  }

  // A soft leaf is paper, never a cover's outside.
  setOutside(): void {}

  setBinding(binding: "left" | "right" | "top"): void {
    this.orient = binding === "top" ? 2 : binding === "right" ? 1 : 0;
  }

  setFaces(resting: PageRef | null, turned: PageRef | null, spine: "left" | "right"): void {
    this.spine = spine;
    this.faces = { resting: resting ? pageKey(resting) : null, turned: turned ? pageKey(turned) : null };
    for (const page of [resting, turned]) if (page) this.load(page);
  }

  /** Fetches a page's image onto the GPU, once. */
  private load(page: PageRef): void {
    const key = pageKey(page);
    const cached = this.cache.get(key);
    if (cached) {
      cached.used = ++this.tick;
      return;
    }
    const entry: Cached = { texture: null, used: ++this.tick };
    this.cache.set(key, entry);
    this.trim();
    const upload = (source: Maybe<Source>) => {
      if (!source || this.cache.get(key) !== entry || this.lost) return;
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } catch {
        // A tainted or broken image: the page is drawn as blank paper.
        gl.deleteTexture(texture);
        return;
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry.texture = texture;
      if (this.last && (this.faces.resting === key || this.faces.turned === key)) this.draw(this.last);
    };
    const ready = (source: Maybe<Source>) => {
      // An image still loading is uploaded once it has.
      if (source && "complete" in source && !(source as HTMLImageElement).complete) {
        (source as HTMLImageElement).addEventListener("load", () => upload(source), { once: true });
      } else upload(source);
    };
    try {
      const result = this.options.texture(page);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<Maybe<Source>>).then(ready, () => {});
      } else ready(result as Maybe<Source>);
    } catch {
      // No image: blank paper.
    }
  }

  /** Lets go of the images least recently needed. */
  private trim(): void {
    const keep = Math.max(2, this.options.cache);
    if (this.cache.size <= keep) return;
    const oldest = [...this.cache.entries()]
      .filter(([key]) => key !== this.faces.resting && key !== this.faces.turned)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of oldest.slice(0, this.cache.size - keep)) {
      if (entry.texture) this.gl.deleteTexture(entry.texture);
      this.cache.delete(key);
    }
  }

  clear(): void {
    for (const entry of this.cache.values()) if (entry.texture) this.gl.deleteTexture(entry.texture);
    this.cache.clear();
  }

  destroy(): void {
    this.clear();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  place(left: number, width: number, height: number): void {
    Object.assign(this.root.style, { left: `${left}px`, width: `${width}px`, height: `${height}px` });
    // A page's width either side, for the half that comes over the spine and
    // for the other way; a little above and below for a tilted curl.
    const pad = Math.round(height * 0.25);
    this.box = { width, height, pad };
    Object.assign(this.canvas.style, {
      left: `${-width}px`,
      top: `${-pad}px`,
      width: `${width * 3}px`,
      height: `${height + pad * 2}px`,
    });
    const ratio = Math.min(this.options.maxPixelRatio, this.doc.defaultView?.devicePixelRatio ?? 1);
    const pixelsWide = Math.max(1, Math.round(width * 3 * ratio));
    const pixelsHigh = Math.max(1, Math.round((height + pad * 2) * ratio));
    if (this.canvas.width !== pixelsWide) this.canvas.width = pixelsWide;
    if (this.canvas.height !== pixelsHigh) this.canvas.height = pixelsHigh;
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
    this.last = null;
  }

  draw(frame: SheetFrame): void {
    this.last = frame;
    const fold = foldGeometry(frame);
    const depth = foldDepth(frame.progress);
    const dark = this.shading.shadow * depth;

    this.keep.style.clipPath = polygon(fold.leaf);
    // The shadow the lifted sheet throws on the page it uncovers, as the DOM
    // renderer draws it.
    this.cast.style.clipPath = polygon(fold.uncovered);
    placeBand(
      this.castBand,
      fold.cast,
      `linear-gradient(to right, rgba(0,0,0,${dark.toFixed(3)}), rgba(0,0,0,0))`,
    );

    if (this.lost) return;
    const gl = this.gl;
    const { width, height, pad } = this.box;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const style = this.doc.defaultView?.getComputedStyle(this.root);
    const paper = parseColour(this.doc, style?.getPropertyValue("--grabfold-paper").trim() ?? "", [0.984, 0.973, 0.945]);
    const lift = parseColour(this.doc, style?.getPropertyValue("--grabfold-lift").trim() ?? "", [1, 1, 1]);

    gl.uniform2f(this.uniform("uSize"), width, height);
    gl.uniform2f(this.uniform("uThrough"), fold.crease.through.x, fold.crease.through.y);
    gl.uniform2f(this.uniform("uNormal"), fold.crease.normal.x, fold.crease.normal.y);
    gl.uniform1f(this.uniform("uRadius"), this.options.radius * width * depth);
    gl.uniform4f(this.uniform("uView"), -width, -pad, width * 3, height + pad * 2);
    gl.uniform2f(this.uniform("uEye"), frame.spine === "left" ? 0 : width, height / 2);
    gl.uniform1f(this.uniform("uPerspective"), 1 / (width * 10));
    gl.uniform3f(this.uniform("uPaper"), ...paper);
    gl.uniform3f(this.uniform("uLiftColor"), ...lift);
    gl.uniform1f(this.uniform("uOrient"), this.orient);
    gl.uniform1f(this.uniform("uSpineLeft"), frame.spine === "left" ? 1 : 0);
    gl.uniform1f(this.uniform("uGutter"), this.shading.gutter);
    gl.uniform1f(this.uniform("uShadow"), this.shading.shadow);
    gl.uniform1f(this.uniform("uLift"), this.shading.lift / 100);
    gl.uniform1f(this.uniform("uDepth"), depth);

    const bind = (unit: number, name: string, has: string, key: string | null) => {
      const texture = key ? (this.cache.get(key)?.texture ?? null) : null;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(this.uniform(name), unit);
      gl.uniform1f(this.uniform(has), texture ? 1 : 0);
    };
    bind(0, "uFront", "uHasFront", this.faces.resting);
    bind(1, "uBack", "uHasBack", this.faces.turned);

    const position = gl.getAttribLocation(this.program, "aPage");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vertices);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indices);
    gl.drawElements(gl.TRIANGLES, this.buffers.count, this.buffers.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  }
}

/**
 * A `foldRenderer` for `Grabfold` that curls soft leaves on the GPU. Rigid
 * leaves still swing as boards. Falls back to the DOM fold where WebGL is not
 * available.
 */
export function webglFold(options: WebGLFoldOptions): (doc: Document, shading: Shading) => SheetRenderer {
  return (doc, shading) => CurlSheet.create(doc, shading, options) ?? new FoldingSheet(doc, shading);
}

/** Whether this browser can draw with `webglFold`. */
export function supportsWebGL(doc: Document = document): boolean {
  const canvas = doc.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}
