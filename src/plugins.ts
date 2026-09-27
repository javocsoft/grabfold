/**
 * grabfold/plugins — the extras a reader expects, each one optional and
 * separate: a strip of thumbnails, zoom, fullscreen, and the address bar
 * following the page.
 *
 * Each takes a book and returns something with a `destroy()`. None reaches
 * into the book: they use its public API and events, so they are also
 * examples of how to build your own.
 *
 * ```ts
 * import { thumbnails, zoom, fullscreen, hashSync } from "grabfold/plugins";
 *
 * thumbnails(book, document.querySelector("#strip"), { render: paintSmall });
 * zoom(book);
 * const screen = fullscreen(book);
 * button.onclick = () => screen.toggle();
 * hashSync(book);
 * ```
 */

import type { Grabfold } from "./book.ts";
import type { PageRef, View } from "./model.ts";

export interface Plugin {
  destroy(): void;
}

/* ------------------------------------------------------------ thumbnails */

export interface ThumbnailOptions {
  /**
   * Paints a small version of a page. The book's own page elements cannot be
   * shown twice, so a thumbnail is painted separately — an image, a canvas,
   * or a scaled-down copy of the page's markup. Return a function to take it
   * down. Without it, each thumbnail shows its page numbers.
   */
  render?: (slot: HTMLElement, page: PageRef) => void | (() => void);
  /** Each thumbnail's height, in pixels. Default 72. */
  height?: number;
  /** Words for an opening, for its accessible name and its default content. */
  label?: (position: number, view: View) => string;
}

function defaultLabel(position: number, view: View): string {
  const name = (page: PageRef | null) => {
    if (!page) return null;
    if (page.kind === "cover") return page.face === "outside" ? `${page.side} cover` : "endpaper";
    return String(page.sheet * 2 + (page.kind === "back" ? 2 : 1));
  };
  const parts = [name(view.left), name(view.right)].filter((part): part is string => part !== null);
  return parts.join("–") || String(position);
}

/**
 * A scrolling strip with one thumbnail per opening. The current one is
 * marked and kept in view; choosing one turns the book there.
 */
export function thumbnails(book: Grabfold, container: HTMLElement, options: ThumbnailOptions = {}): Plugin {
  const doc = container.ownerDocument;
  const height = options.height ?? 72;
  const label = options.label ?? defaultLabel;
  const strip = doc.createElement("div");
  strip.className = "grabfold-thumbnails";
  strip.setAttribute("role", "list");
  Object.assign(strip.style, {
    display: "flex",
    gap: "8px",
    overflowX: "auto",
    padding: "6px 2px",
    scrollbarWidth: "thin",
  });
  container.append(strip);

  let cleanups: Array<() => void> = [];
  let buttons = new Map<number, HTMLButtonElement>();
  let span = "";
  const painted = new WeakSet<Element>();

  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) if (entry.isIntersecting) paint(entry.target as HTMLButtonElement);
          },
          { root: strip, rootMargin: "0px 200px" },
        );

  function paint(button: HTMLButtonElement): void {
    if (painted.has(button)) return;
    painted.add(button);
    observer?.unobserve(button);
    const position = Number(button.dataset.position);
    const view = book.viewAt(position);
    const size = book.dimensions;
    const top = book.binding === "top";
    // One page as seen, width over height.
    const ratio = top ? size.cellHeight / size.cellWidth : size.cellWidth / size.cellHeight;
    for (const page of [view.left, view.right]) {
      if (!page) continue;
      const slot = doc.createElement("div");
      slot.className = "grabfold-thumbnail-page";
      Object.assign(slot.style, {
        position: "relative",
        overflow: "hidden",
        height: top ? `${height / 2}px` : `${height}px`,
        width: `${(top ? height / 2 : height) * ratio}px`,
        background: "var(--grabfold-paper, #fbf8f1)",
      });
      if (options.render) {
        const cleanup = options.render(slot, page);
        if (typeof cleanup === "function") cleanups.push(cleanup);
      } else {
        slot.textContent = defaultLabel(position, { left: null, right: page });
        Object.assign(slot.style, { display: "grid", placeItems: "center", font: "11px system-ui, sans-serif" });
      }
      button.firstElementChild!.append(slot);
    }
  }

  function build(): void {
    const { first, last } = book.bounds;
    const next = `${first}:${last}:${book.layout}:${book.binding}`;
    if (next === span) return;
    span = next;
    for (const cleanup of cleanups.splice(0)) cleanup();
    strip.replaceChildren();
    buttons = new Map();
    for (let position = first; position <= last; position += 1) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "grabfold-thumbnail";
      button.dataset.position = String(position);
      button.setAttribute("role", "listitem");
      button.setAttribute("aria-label", label(position, book.viewAt(position)));
      Object.assign(button.style, {
        flex: "none",
        padding: "3px",
        border: "2px solid transparent",
        borderRadius: "6px",
        background: "none",
        cursor: "pointer",
      });
      const pages = doc.createElement("div");
      Object.assign(pages.style, {
        display: "flex",
        flexDirection: book.binding === "top" ? "column" : book.binding === "right" ? "row-reverse" : "row",
        boxShadow: "0 1px 3px rgba(0,0,0,.25)",
      });
      button.append(pages);
      button.addEventListener("click", () => void book.turnTo(position));
      strip.append(button);
      buttons.set(position, button);
      if (observer) observer.observe(button);
      else paint(button);
    }
    mark(false);
  }

  function mark(smooth = true): void {
    for (const [position, button] of buttons) {
      const current = position === book.position;
      button.style.borderColor = current ? "currentColor" : "transparent";
      if (current) {
        button.setAttribute("aria-current", "page");
        const left = button.offsetLeft - strip.clientWidth / 2 + button.clientWidth / 2;
        strip.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
      } else button.removeAttribute("aria-current");
    }
  }

  build();
  const offs = [
    book.on("change", () => {
      build();
      mark();
    }),
    book.on("layout", () => {
      span = "";
      build();
    }),
  ];

  return {
    destroy() {
      for (const off of offs) off();
      observer?.disconnect();
      for (const cleanup of cleanups.splice(0)) cleanup();
      strip.remove();
    },
  };
}

/* ------------------------------------------------------------------ zoom */

export interface ZoomOptions {
  /** The most it zooms in. Default 3. */
  max?: number;
  /** Ctrl + wheel, and a trackpad's pinch, zoom about the pointer. Default true. */
  wheel?: boolean;
  /** Two fingers pinch to zoom. Default true. */
  pinch?: boolean;
  /** A double click or double tap zooms in, and out again. Default true. */
  doubleTap?: boolean;
  /** How far a double tap zooms in. Default 2. */
  doubleTapScale?: number;
}

export interface ZoomPlugin extends Plugin {
  readonly scale: number;
  /** Zooms to a scale, about a point on screen (the middle of the book by default). */
  zoomTo(scale: number, clientX?: number, clientY?: number): void;
  reset(): void;
}

/**
 * Zoom and pan. While zoomed in, dragging pans the page instead of turning
 * it; zoom back out to turn again. Escape zooms out.
 */
export function zoom(book: Grabfold, options: ZoomOptions = {}): ZoomPlugin {
  const max = options.max ?? 3;
  const frame = book.element;
  const root = book.bookElement;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let gestures: boolean | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; mid: { x: number; y: number }; scale: number } | null = null;
  let pan: { x: number; y: number } | null = null;
  let lastTap = { time: 0, x: 0, y: 0 };
  const original = {
    overflowX: frame.style.overflowX,
    overflowY: frame.style.overflowY,
    touchAction: frame.style.touchAction,
  };

  const origin = () => {
    const [x, y] = getComputedStyle(root).transformOrigin.split(" ").map(parseFloat);
    return { x: x || 0, y: y || 0 };
  };
  /** The book's box on screen as it is laid out, before any zoom. */
  const base = () => {
    const box = frame.getBoundingClientRect();
    return { x: box.left + root.offsetLeft, y: box.top + root.offsetTop };
  };

  function clamp(): void {
    const size = book.dimensions;
    const o = origin();
    tx = Math.min(o.x * (scale - 1), Math.max((size.displayWidth - o.x) * (1 - scale), tx));
    ty = Math.min(o.y * (scale - 1), Math.max((size.displayHeight - o.y) * (1 - scale), ty));
  }

  function apply(animate = false): void {
    clamp();
    root.style.transition = animate ? "scale .25s ease-out, translate .25s ease-out" : "";
    root.style.scale = scale === 1 ? "" : String(scale);
    root.style.translate = scale === 1 ? "" : `${tx}px ${ty}px`;
    const zoomed = scale > 1.001;
    frame.style.overflowX = zoomed ? "hidden" : original.overflowX;
    frame.style.overflowY = zoomed ? "hidden" : original.overflowY;
    frame.style.touchAction = zoomed ? "none" : original.touchAction;
    frame.dataset.zoomed = zoomed ? "true" : "";
    if (zoomed && gestures === null) {
      gestures = true;
      book.cancelDrag();
      book.setOptions({ gestures: false });
    } else if (!zoomed && gestures !== null) {
      gestures = null;
      book.setOptions({ gestures: true });
    }
  }

  function zoomTo(next: number, clientX?: number, clientY?: number, animate = false): void {
    const target = Math.min(max, Math.max(1, next));
    const at = base();
    const o = origin();
    const size = book.dimensions;
    const cx = (clientX ?? at.x + size.displayWidth / 2) - at.x;
    const cy = (clientY ?? at.y + size.displayHeight / 2) - at.y;
    // The point under the pointer stays under it.
    const qx = (cx - o.x - tx) / scale + o.x;
    const qy = (cy - o.y - ty) / scale + o.y;
    scale = target;
    tx = cx - o.x - scale * (qx - o.x);
    ty = cy - o.y - scale * (qy - o.y);
    apply(animate);
  }

  const onDown = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && options.pinch !== false) {
      book.cancelDrag();
      const [a, b] = [...pointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        scale,
      };
      pan = null;
      event.stopPropagation();
      return;
    }
    if (scale > 1.001 && pointers.size === 1) {
      pan = { x: event.clientX, y: event.clientY };
      event.stopPropagation();
    }
  };

  const onMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      tx += mid.x - pinch.mid.x;
      ty += mid.y - pinch.mid.y;
      pinch.mid = mid;
      zoomTo((pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance, mid.x, mid.y);
      event.stopPropagation();
    } else if (pan) {
      tx += event.clientX - pan.x;
      ty += event.clientY - pan.y;
      pan = { x: event.clientX, y: event.clientY };
      apply();
      event.stopPropagation();
    }
  };

  const onUp = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pinch && pointers.size < 2) {
      pinch = null;
      if (scale < 1.05) zoomTo(1, undefined, undefined, true);
      event.stopPropagation();
      return;
    }
    pan = null;
    // A double tap, for fingers; a mouse has dblclick.
    if (options.doubleTap !== false && event.pointerType !== "mouse") {
      const now = event.timeStamp;
      const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30;
      if (now - lastTap.time < 300 && near) {
        toggle(event.clientX, event.clientY);
        lastTap = { time: 0, x: 0, y: 0 };
      } else lastTap = { time: now, x: event.clientX, y: event.clientY };
    }
  };

  const toggle = (x: number, y: number) =>
    zoomTo(scale > 1.001 ? 1 : (options.doubleTapScale ?? 2), x, y, true);

  const onWheel = (event: WheelEvent) => {
    if (options.wheel === false || !event.ctrlKey) return;
    event.preventDefault();
    zoomTo(scale * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
  };
  const onDouble = (event: MouseEvent) => {
    if (options.doubleTap === false) return;
    toggle(event.clientX, event.clientY);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && scale > 1.001) zoomTo(1, undefined, undefined, true);
  };
  const onResize = () => apply();

  frame.addEventListener("pointerdown", onDown, true);
  frame.addEventListener("pointermove", onMove, true);
  frame.addEventListener("pointerup", onUp, true);
  frame.addEventListener("pointercancel", onUp, true);
  frame.addEventListener("wheel", onWheel, { passive: false });
  frame.addEventListener("dblclick", onDouble);
  frame.addEventListener("keydown", onKey);
  const offResize = book.on("resize", onResize);

  return {
    get scale() {
      return scale;
    },
    zoomTo: (next, x, y) => zoomTo(next, x, y, true),
    reset: () => zoomTo(1, undefined, undefined, true),
    destroy() {
      frame.removeEventListener("pointerdown", onDown, true);
      frame.removeEventListener("pointermove", onMove, true);
      frame.removeEventListener("pointerup", onUp, true);
      frame.removeEventListener("pointercancel", onUp, true);
      frame.removeEventListener("wheel", onWheel);
      frame.removeEventListener("dblclick", onDouble);
      frame.removeEventListener("keydown", onKey);
      offResize();
      scale = 1;
      apply();
    },
  };
}

/* ------------------------------------------------------------ fullscreen */

export interface FullscreenPlugin extends Plugin {
  readonly active: boolean;
  enter(): Promise<void>;
  exit(): Promise<void>;
  toggle(): Promise<void>;
}

/**
 * The book alone on the screen, as large as fits. The book is laid out to
 * fit the screen while it is there, and as before once it leaves.
 */
export function fullscreen(book: Grabfold, options: { background?: string } = {}): FullscreenPlugin {
  const frame = book.element;
  const doc = frame.ownerDocument;
  let fit: "width" | "contain" | null = null;
  const background = options.background ?? "var(--grabfold-backdrop, #1f1d1a)";

  const onChange = () => {
    const active = doc.fullscreenElement === frame;
    if (active && fit === null) {
      fit = "width";
      frame.style.background = background;
      book.setOptions({ fit: "contain" });
    } else if (!active && fit !== null) {
      frame.style.background = "";
      book.setOptions({ fit });
      fit = null;
    }
  };
  doc.addEventListener("fullscreenchange", onChange);

  const plugin: FullscreenPlugin = {
    get active() {
      return doc.fullscreenElement === frame;
    },
    async enter() {
      if (doc.fullscreenElement !== frame) await frame.requestFullscreen?.();
      book.bookElement.focus({ preventScroll: true });
    },
    async exit() {
      if (doc.fullscreenElement === frame) await doc.exitFullscreen();
    },
    toggle() {
      return plugin.active ? plugin.exit() : plugin.enter();
    },
    destroy() {
      doc.removeEventListener("fullscreenchange", onChange);
      if (doc.fullscreenElement === frame) void doc.exitFullscreen();
    },
  };
  return plugin;
}

/* ------------------------------------------------------------- hash sync */

export interface HashSyncOptions {
  /** The hash for a position. Default `#position=3`. */
  format?: (position: number) => string;
  /** A position from the hash, or null for none. */
  parse?: (hash: string) => number | null;
  /** Add a history entry per turn, so Back turns back. Default false: the hash is replaced. */
  history?: boolean;
}

/**
 * Keeps the address bar on the page open, so a link opens the book there and
 * a reload does not lose the reader's place.
 */
export function hashSync(book: Grabfold, options: HashSyncOptions = {}): Plugin {
  const win = book.element.ownerDocument.defaultView ?? window;
  const format = options.format ?? ((position: number) => `#position=${position}`);
  const parse =
    options.parse ??
    ((hash: string) => {
      const match = /position=(-?\d+)/.exec(hash);
      return match ? Number(match[1]) : null;
    });

  const read = (animate: boolean) => {
    const position = parse(win.location.hash);
    if (position === null || position === book.position) return;
    if (animate) void book.turnTo(position);
    else book.jumpTo(position);
  };
  read(false);

  const off = book.on("change", ({ position }) => {
    const hash = format(position);
    if (win.location.hash === hash) return;
    const url = `${win.location.pathname}${win.location.search}${hash}`;
    if (options.history) win.history.pushState(null, "", url);
    else win.history.replaceState(win.history.state, "", url);
  });
  const onHash = () => read(true);
  win.addEventListener("hashchange", onHash);
  win.addEventListener("popstate", onHash);

  return {
    destroy() {
      off();
      win.removeEventListener("hashchange", onHash);
      win.removeEventListener("popstate", onHash);
    },
  };
}
