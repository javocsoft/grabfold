import {
  canTurn,
  clampPosition,
  dragAllowed,
  dragDirection,
  dragProgress,
  easeOut,
  firstPosition,
  isHardLeaf,
  lastPosition,
  planFlight,
  route,
  view,
  type Covers,
  type Direction,
  type FlightPlan,
  type Layout,
  type PageRef,
  type Shape,
  type View,
} from "./model.ts";
import {
  blockCount,
  closedShift,
  PEEK_MAX,
  peekProgress,
  releaseSpeed,
  releaseTarget,
  settleDuration,
  stackWidths,
  type Sample,
} from "./physics.ts";
import {
  bookTransform,
  computeSize,
  contentTransform,
  keyTurn,
  toBookPoint,
  type Binding,
  type Size,
} from "./space.ts";
import { RigidSheet } from "./board.ts";
import { FoldingSheet, gutterGradient, type Shading, type SheetRenderer } from "./sheet.ts";

/**
 * Paints one page into the element given.
 *
 * Each page is painted **once**, into an element of its own, and that element
 * is then *moved* wherever the page needs to be: from its side of the book
 * onto the turning sheet, and from the sheet onto the facing side. Nothing is
 * cloned and nothing is painted twice, so a page keeps its state, its loaded
 * images and its event handlers through a turn.
 *
 * Return a function to take the page down, and the book calls it when it
 * lets the page go — once it has been out of sight for a while, or when the
 * book is destroyed. Return nothing and the element is simply dropped.
 */
export type RenderPage = (slot: HTMLElement, page: PageRef) => void | (() => void);

/**
 * Makes whatever draws a soft leaf mid-turn. The default folds DOM;
 * `grabfold/webgl` curls it on the GPU.
 */
export type FoldRenderer = (doc: Document, shading: Shading) => SheetRenderer;

export interface TurnEvent {
  direction: Direction;
  /** The position the book was open at. */
  from: number;
  /** The position it is going to. */
  to: number;
  /**
   * How long the turn has left to run, in milliseconds; 0 when instant.
   * A drag let go near the end has less left than a turn started from code.
   */
  duration: number;
  /** More than one step, made as a single turn. */
  jump: boolean;
  /** A rigid leaf — a hard cover, or a board page — swinging rather than folding. */
  hard: boolean;
  source: "drag" | "api" | "keyboard";
}

/** Where the book is open now, and what that shows. */
export interface ChangeEvent {
  position: number;
  view: View;
}

/** What `book.on` can listen for. */
export interface GrabfoldEvents {
  /** A turn has been committed: at once from code, on release for a drag. */
  turnstart: TurnEvent;
  /** A turn has landed. */
  turn: TurnEvent;
  /** The book is open somewhere else: a turn landed, or it was jumped or reshaped. */
  change: ChangeEvent;
  /** The layout has switched between spread and single. */
  layout: Layout;
  /** The book has been laid out at a new size. */
  resize: Size;
}

/**
 * Anything that can make a sound for a turn. grabfold/sound's
 * `createPageTurnSound` is one; so is any object with a `play` method.
 *
 * Called once per turn that goes through, at the moment it is committed —
 * with the time the turn has left, so the sound can land with the page.
 */
export interface TurnSound {
  play(event: TurnEvent): void;
}

export interface GrabfoldOptions {
  /** How many sheets the book has. Each sheet has a front and a back. */
  sheets: number;
  /** Paints a page. See `RenderPage`. */
  render: RenderPage;
  /**
   * "inside": the covers' inner faces, glued down, at either end (default).
   * "hard": real covers that turn as rigid boards; the book starts closed.
   * "none": no covers.
   */
  covers?: Covers;
  /** Which sheets are rigid, like the pages of a board book. None by default. */
  hard?: (sheet: number) => boolean;
  /**
   * Where the book is bound. "left" (default); "right" for right-to-left
   * books; "top" for calendars and notepads, turned upwards.
   */
  binding?: Binding;
  /** "spread" (two pages), "single", or "auto" to follow `spreadQuery`. Default "auto". */
  layout?: "auto" | Layout;
  /** When `layout` is "auto", the media query for showing a spread. */
  spreadQuery?: string;
  /** One page's width divided by its height, as seen. Default 3 / 4. */
  pageRatio?: number;
  /**
   * "width" (default): as wide as the container, as tall as that makes it.
   * "contain": as large as fits inside the container, which must have a height.
   */
  fit?: "width" | "contain";
  /** Where to open. Default: the very start. */
  position?: number;
  /** A full turn's running time in milliseconds. Default 680. */
  duration?: number;
  /** Past this share of the way over, letting go finishes the turn. Default 0.4. */
  commitAt?: number;
  /** Sideways movement, in pixels, before a press becomes a drag. Default 10. */
  dragThreshold?: number;
  /** Pages can be taken hold of and turned by hand. Default true. */
  gestures?: boolean;
  /** A quick flick turns the page however little of the way it was pulled. Default true. */
  flick?: boolean;
  /** A page's edge lifts a little when the mouse comes near it. Default true. */
  peek?: boolean;
  /**
   * The most the stacks of pages either side are drawn thick, in pixels, for
   * a book of a hundred sheets or more; 0 for none. Default 10.
   */
  thickness?: number;
  /** A block of pages can be taken from the edge of a stack and turned at once. Default true. */
  grabBlock?: boolean;
  /** A book showing only one page, closed, sits in the middle of a spread. Default true. */
  center?: boolean;
  /** Turn instantly. "auto" follows prefers-reduced-motion. Default "auto". */
  reducedMotion?: "auto" | boolean;
  /** Arrow keys and Page Up/Down turn pages while the book has focus. Default true. */
  keyboard?: boolean;
  /** Accessible name for the book. Default "Book". */
  label?: string;
  /** Darkest the crease's shading gets, 0–1. Default 0.4. */
  shadow?: number;
  /** Darkness of the gutter at the spine, 0–1; 0 for none. Default 0.3. */
  gutter?: number;
  /** How far a turning page lightens towards `--grabfold-lift`, in per cent. Default 45. */
  lift?: number;
  /** Draws soft leaves mid-turn. Default (or null): DOM folding. See `grabfold/webgl`. */
  foldRenderer?: FoldRenderer | null;
  /** A sound for each turn. See `grabfold/sound`. None by default. */
  sound?: TurnSound | null;
  /** A turn has been committed: at once from code, on release for a drag. */
  onTurnStart?: (event: TurnEvent) => void;
  /** A turn has landed. */
  onTurn?: (event: TurnEvent) => void;
  /** The layout has switched between spread and single. */
  onLayoutChange?: (layout: Layout) => void;
}

type Optional = "hard" | "sound" | "foldRenderer" | "onTurnStart" | "onTurn" | "onLayoutChange";
type Resolved = Required<Omit<GrabfoldOptions, Optional>> & Pick<GrabfoldOptions, Optional>;

const DEFAULTS = {
  covers: "inside" as Covers,
  binding: "left" as Binding,
  layout: "auto" as const,
  spreadQuery: "(min-width: 640px)",
  pageRatio: 3 / 4,
  fit: "width" as const,
  duration: 680,
  commitAt: 0.4,
  dragThreshold: 10,
  gestures: true,
  flick: true,
  peek: true,
  thickness: 10,
  grabBlock: true,
  center: true,
  reducedMotion: "auto" as const,
  keyboard: true,
  label: "Book",
  shadow: 0.4,
  // Soft enough for light paper; dark paper can take more.
  gutter: 0.3,
  lift: 45,
};

/** A place a page can be put: either side of the book, or a face of the sheet. */
interface Holder {
  el: HTMLElement;
  page: PageRef | null;
}

/** A page painted once, and moved about from then on. */
interface Painted {
  el: HTMLElement;
  cleanup: (() => void) | null;
  lastShown: number;
}

/**
 * How many pages out of sight are kept, painted, for coming back to.
 *
 * Turning back finds the page as it was left rather than painted afresh. A
 * handful is enough for going back and forth; beyond that they are let go.
 */
const KEEP_HIDDEN = 6;

/** How far out from a stack its grab zone reaches, at least, in pixels. */
const BLOCK_ZONE = 18;

/** What a page holds that is for using, not for turning by: no peek over these. */
const INTERACTIVE =
  'a[href], button, input, select, textarea, label, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [data-grabfold-no-peek]';

/** The widest a peek's zone gets, in pixels, however large the page. */
const PEEK_ZONE = 72;

function pageKey(page: PageRef): string {
  return page.kind === "cover" ? `cover:${page.side}:${page.face}` : `${page.kind}:${page.sheet}`;
}

/** A closed book shows a cover's outside, which has no gutter and no binding. */
function isOutside(page: PageRef | null): boolean {
  return page?.kind === "cover" && page.face === "outside";
}

interface Flight {
  plan: FlightPlan;
  progress: number;
  lift: number;
  grabY: number;
  width: number;
  height: number;
  source: TurnEvent["source"];
  /** Only lifted by a hovering mouse: never committed, never heard. */
  peek: boolean;
}

interface Drag {
  pointerId: number;
  /** In the book's own space. */
  startX: number;
  startY: number;
  grabY: number;
  side: "left" | "right";
  decided: boolean;
  /** Where the turn already was when the hand took it over from a peek. */
  base: number;
  /** A block taken from a stack's edge: how many steps, and which way. */
  block: { count: number; direction: Direction } | null;
  samples: Sample[];
}

const STYLE_ID = "grabfold-styles";

/**
 * The few rules that cannot be inline styles, added once per document.
 *
 * Wrapped in :where() so they weigh nothing, and any stylesheet of the page's
 * own overrides them without a fight.
 */
function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
:where(.grabfold[data-dragging="true"]), :where(.grabfold[data-dragging="true"] *) { cursor: grabbing !important; }
:where(.grabfold:focus-visible) { outline: 2px solid Highlight; outline-offset: 4px; }
:where(.grabfold-block-label) { font: 600 12px/1 system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.72); padding: 5px 7px; border-radius: 999px; white-space: nowrap; }
`;
  doc.head.append(style);
}

/**
 * A book whose pages can be taken hold of anywhere and turned.
 *
 * ```ts
 * const book = new Grabfold(element, {
 *   sheets: 12,
 *   render(slot, page) {
 *     slot.textContent = page.kind === "cover" ? "grabfold" : `${page.kind} ${page.sheet}`;
 *   },
 * });
 * ```
 */
export class Grabfold {
  private readonly container: HTMLElement;
  private readonly doc: Document;
  private readonly win: Window;
  private options: Resolved;

  /** Fills the container's width, and holds the book at its size. */
  private readonly frame: HTMLDivElement;
  /** The book in its own space: bound on the left, before any binding transform. */
  private readonly root: HTMLDivElement;
  /** Slid across to keep a closed book in the middle. */
  private readonly stage: HTMLDivElement;
  private readonly cells: HTMLDivElement;
  private readonly leftCell: HTMLDivElement;
  private readonly rightCell: HTMLDivElement;
  private readonly leftGutter: HTMLDivElement;
  private readonly rightGutter: HTMLDivElement;
  private readonly stacks: { left: HTMLDivElement; right: HTMLDivElement };
  private readonly handles: { left: HTMLDivElement; right: HTMLDivElement };
  private readonly blockLabel: HTMLDivElement;
  /** Draws a soft leaf folding. */
  private soft: SheetRenderer;
  /** Draws a rigid leaf swinging. */
  private readonly rigid: RigidSheet;
  /** Whichever of the two the current turn uses. */
  private sheet: SheetRenderer;
  private readonly holders: { left: Holder; right: Holder; resting: Holder; turned: Holder };
  private readonly painted = new Map<string, Painted>();
  private tick = 0;

  private currentLayout: Layout;
  private size: Size;
  /**
   * Where the book is open, before clamping to the layout. Kept raw so that a
   * book opened on a phone's cover (-2) reads as the same opening on a spread
   * (-1), and turning a phone round does not lose the reader's place.
   */
  private raw: number;
  private flight: Flight | null = null;
  private drag: Drag | null = null;
  private frameRequest: number | null = null;
  private pending = false;
  private resolveTurn: ((landed: boolean) => void) | null = null;
  /** Set while turnTo walks a route of several turns, so nothing cuts in. */
  private routing = false;
  /** Set when a drag happened, so the click it ends on does not reach a page. */
  private dragged = false;
  private destroyed = false;
  /** Where a peek is heading, and the loop easing it there. */
  private peekTarget = { progress: 0, grabY: 0 };
  private peekRequest: number | null = null;

  private readonly listeners = new Map<keyof GrabfoldEvents, Set<(event: never) => void>>();
  private readonly spreadMedia: MediaQueryList | null;
  private readonly calmMedia: MediaQueryList | null;
  private readonly cleanups: Array<() => void> = [];

  constructor(container: HTMLElement, options: GrabfoldOptions) {
    this.container = container;
    this.doc = container.ownerDocument;
    this.win = this.doc.defaultView ?? window;
    this.options = { ...DEFAULTS, ...stripUndefined(options) } as Resolved;
    injectStyles(this.doc);

    this.spreadMedia = this.win.matchMedia ? this.win.matchMedia(this.options.spreadQuery) : null;
    this.calmMedia = this.win.matchMedia
      ? this.win.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

    this.frame = this.doc.createElement("div");
    this.frame.className = "grabfold-frame";
    // Clipped across: the folded half of a page is a whole page's box, turned
    // and cut to shape, and the box would otherwise make the page scroll
    // sideways while a turn runs. Up and down stays open, for a board lifting
    // towards the reader.
    Object.assign(this.frame.style, { position: "relative", width: "100%", overflowX: "clip" });

    this.root = this.doc.createElement("div");
    this.root.className = "grabfold";
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-roledescription", "book");
    Object.assign(this.root.style, {
      position: "absolute",
      top: "0",
      left: "0",
      userSelect: "none",
      webkitUserSelect: "none",
    });

    this.stage = this.doc.createElement("div");
    this.stage.className = "grabfold-stage";
    // A point, not a box: slid across to centre a closed book, a box the size
    // of the book would stick out past the page and make it scroll.
    Object.assign(this.stage.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0" });

    this.cells = this.doc.createElement("div");
    this.cells.className = "grabfold-pages";
    // Also a point, with each page placed on it, for the same reason.
    Object.assign(this.cells.style, { position: "absolute", top: "0", width: "0", height: "0" });

    const makeCell = (side: "left" | "right") => {
      const cell = this.doc.createElement("div");
      cell.className = "grabfold-page";
      cell.dataset.side = side;
      Object.assign(cell.style, {
        position: "absolute",
        top: "0",
        overflow: "hidden",
        // Opaque. A transparent page is a hole in the book, and the folded
        // half has to cover the page it lands on.
        background: "var(--grabfold-paper, #fbf8f1)",
      });
      const slot = this.doc.createElement("div");
      slot.className = "grabfold-slot";
      Object.assign(slot.style, { position: "absolute", inset: "0" });
      const gutter = this.doc.createElement("div");
      gutter.className = "grabfold-gutter";
      // Over the content: whatever is on a page goes down into the binding
      // with the paper.
      Object.assign(gutter.style, { position: "absolute", inset: "0", pointerEvents: "none" });
      cell.append(slot, gutter);
      return { cell, slot, gutter };
    };
    const left = makeCell("left");
    const right = makeCell("right");
    this.leftCell = left.cell;
    this.rightCell = right.cell;
    this.leftGutter = left.gutter;
    this.rightGutter = right.gutter;
    this.cells.append(left.cell, right.cell);

    const makeStack = (side: "left" | "right") => {
      const stack = this.doc.createElement("div");
      stack.className = "grabfold-stack";
      stack.dataset.side = side;
      stack.setAttribute("aria-hidden", "true");
      Object.assign(stack.style, {
        position: "absolute",
        top: "0",
        pointerEvents: "none",
        // The edges of the leaves, one hairline apart, and darker the further
        // they are from the page on show.
        backgroundColor: "var(--grabfold-edge, var(--grabfold-paper, #fbf8f1))",
        backgroundImage: `repeating-linear-gradient(to right, rgba(0,0,0,.13) 0 1px, rgba(0,0,0,0) 1px 2.5px), linear-gradient(${
          side === "left" ? "to left" : "to right"
        }, rgba(0,0,0,.04), rgba(0,0,0,.22))`,
      });
      const handle = this.doc.createElement("div");
      handle.className = "grabfold-block-handle";
      handle.dataset.side = side;
      handle.setAttribute("aria-hidden", "true");
      Object.assign(handle.style, { position: "absolute", top: "0", cursor: "grab" });
      return { stack, handle };
    };
    const leftStack = makeStack("left");
    const rightStack = makeStack("right");
    this.stacks = { left: leftStack.stack, right: rightStack.stack };
    this.handles = { left: leftStack.handle, right: rightStack.handle };

    this.blockLabel = this.doc.createElement("div");
    this.blockLabel.className = "grabfold-block-label";
    this.blockLabel.setAttribute("aria-hidden", "true");
    Object.assign(this.blockLabel.style, {
      position: "absolute",
      zIndex: "5",
      pointerEvents: "none",
      display: "none",
    });

    this.soft = this.makeSoft();
    this.rigid = new RigidSheet(this.doc, this.shading());
    this.sheet = this.soft;
    this.cells.append(this.soft.root, this.rigid.root);
    this.stage.append(
      this.stacks.left,
      this.stacks.right,
      this.cells,
      this.handles.left,
      this.handles.right,
      this.blockLabel,
    );
    this.root.append(this.stage);
    this.frame.append(this.root);
    this.container.append(this.frame);

    this.holders = {
      left: { el: left.slot, page: null },
      right: { el: right.slot, page: null },
      resting: { el: this.soft.restingSlot, page: null },
      turned: { el: this.soft.turnedSlot, page: null },
    };

    this.currentLayout = this.resolveLayout();
    this.raw = options.position ?? -2;
    this.size = this.measure();
    this.applyLayout();
    this.applyChrome();
    this.showView(view(this.position, this.currentLayout, this.shape()));
    this.updateCursors();
    this.listen();
  }

  /* ------------------------------------------------------------- reading */

  /** Where the book is open: the index of the sheet whose back is on the left. */
  get position(): number {
    return clampPosition(this.raw, this.currentLayout, this.shape());
  }

  get layout(): Layout {
    return this.currentLayout;
  }

  get binding(): Binding {
    return this.options.binding;
  }

  get sheets(): number {
    return this.options.sheets;
  }

  get isTurning(): boolean {
    return this.flight !== null && !this.flight.peek;
  }

  /** The pages on show: `left` is null on a single page. */
  get view(): View {
    return view(this.position, this.currentLayout, this.shape());
  }

  /** The element the book lives in: what to size, zoom or put in fullscreen. */
  get element(): HTMLElement {
    return this.frame;
  }

  /** The book's own element, which takes the gestures and the focus. */
  get bookElement(): HTMLElement {
    return this.root;
  }

  /** How large the book is laid out, pages and whole. */
  get dimensions(): Size {
    return { ...this.size };
  }

  /** The first and last positions the book can be open at in its current layout. */
  get bounds(): { first: number; last: number } {
    return {
      first: firstPosition(this.currentLayout, this.shape()),
      last: lastPosition(this.currentLayout, this.shape()),
    };
  }

  canNext(): boolean {
    return canTurn(this.position, "next", this.currentLayout, this.shape());
  }

  canPrev(): boolean {
    return canTurn(this.position, "prev", this.currentLayout, this.shape());
  }

  /** The pages a position shows in the current layout, without going there. */
  viewAt(position: number): View {
    return view(clampPosition(position, this.currentLayout, this.shape()), this.currentLayout, this.shape());
  }

  /* -------------------------------------------------------------- events */

  /**
   * Listens for something happening to the book. Returns a function that
   * stops listening.
   *
   * ```ts
   * const off = book.on("turn", (event) => console.log(event.to));
   * ```
   */
  on<K extends keyof GrabfoldEvents>(type: K, handler: (event: GrabfoldEvents[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler as (event: never) => void);
    return () => this.off(type, handler);
  }

  off<K extends keyof GrabfoldEvents>(type: K, handler: (event: GrabfoldEvents[K]) => void): void {
    this.listeners.get(type)?.delete(handler as (event: never) => void);
  }

  private emit<K extends keyof GrabfoldEvents>(type: K, event: GrabfoldEvents[K]): void {
    if (type === "turnstart") this.options.onTurnStart?.(event as TurnEvent);
    if (type === "turn") this.options.onTurn?.(event as TurnEvent);
    if (type === "layout") this.options.onLayoutChange?.(event as Layout);
    for (const handler of [...(this.listeners.get(type) ?? [])]) {
      (handler as (event: GrabfoldEvents[K]) => void)(event);
    }
  }

  private emitChange(): void {
    this.emit("change", { position: this.position, view: this.view });
  }

  /* ------------------------------------------------------------- turning */

  next(): Promise<boolean> {
    return this.turnTo(this.position + 1);
  }

  prev(): Promise<boolean> {
    return this.turnTo(this.position - 1);
  }

  /**
   * Turns to a position, animated. Several pages away is still one turn — or,
   * where a rigid leaf is in the way, one turn either side of it: a closed
   * book going to page 10 opens its cover, then riffles the pages.
   *
   * Resolves true once it has landed, false if there was nowhere to go or a
   * turn was already under way.
   */
  turnTo(position: number, source: TurnEvent["source"] = "api"): Promise<boolean> {
    if (this.flight?.peek) this.endPeek();
    if (this.destroyed || this.flight || this.routing || this.drag?.decided) {
      return Promise.resolve(false);
    }
    const stops = route(this.position, position, this.currentLayout, this.shape());
    if (stops.length === 0) return Promise.resolve(false);
    if (stops.length === 1) return this.turnOnce(stops[0], source);

    this.routing = true;
    return (async () => {
      try {
        for (const stop of stops) {
          if (this.destroyed || !(await this.turnOnce(stop, source))) return false;
        }
        return true;
      } finally {
        this.routing = false;
      }
    })();
  }

  private turnOnce(target: number, source: TurnEvent["source"]): Promise<boolean> {
    const plan = planFlight(this.position, target, this.currentLayout, this.shape());
    if (!plan) return Promise.resolve(false);
    // No pointer, so the leaf is taken by the middle of its edge and the
    // crease comes out upright.
    this.begin(plan, source, this.size.cellHeight / 2);
    return this.settle(1);
  }

  /** Opens the book at a position at once: no animation, no turn events. */
  jumpTo(position: number): void {
    if (this.destroyed) return;
    this.abandonFlight();
    this.raw = clampPosition(position, this.currentLayout, this.shape());
    this.showView(this.view);
    this.collect();
    this.updateCursors();
    this.emitChange();
  }

  /**
   * Lets go of a page being dragged, dropping it back where it was, and
   * stops a press from becoming a drag. For anything that takes the pointer
   * over — a pinch to zoom, say.
   */
  cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    delete this.root.dataset.dragging;
    if (drag?.decided && this.flight && !this.flight.peek && this.frameRequest === null) {
      void this.settle(0);
    }
    this.endPeek();
  }

  /** Paints every page again, after their content changed. */
  refresh(): void {
    this.soft.clear?.();
    for (const [key, entry] of this.painted) {
      this.unpaint(entry);
      const page = this.pageFromKey(key);
      if (page) this.paint(entry, page);
    }
  }

  /** Changes options on a live book. */
  setOptions(options: Partial<GrabfoldOptions>): void {
    if (this.destroyed) return;
    const before = this.options;
    this.options = { ...this.options, ...stripUndefined(options) } as Resolved;
    this.rigid.setShading(this.shading());

    if (before.foldRenderer !== this.options.foldRenderer) {
      this.abandonFlight();
      this.soft.root.remove();
      this.soft.destroy?.();
      this.soft = this.makeSoft();
      this.soft.setBinding?.(this.options.binding);
      this.cells.prepend(this.soft.root);
      this.sheet = this.soft;
    }
    this.soft.setShading(this.shading());

    const reshaped =
      before.sheets !== this.options.sheets ||
      before.covers !== this.options.covers ||
      before.hard !== this.options.hard ||
      before.layout !== this.options.layout ||
      before.binding !== this.options.binding;
    const resized =
      reshaped ||
      before.pageRatio !== this.options.pageRatio ||
      before.fit !== this.options.fit ||
      before.thickness !== this.options.thickness ||
      before.center !== this.options.center;
    if (before.render !== this.options.render) {
      this.abandonFlight();
      this.refresh();
    }
    if (!this.options.gestures || !this.options.peek) this.endPeek();
    if (resized) {
      const from = this.position;
      this.abandonFlight();
      this.currentLayout = this.resolveLayout();
      this.size = this.measure();
      this.applyLayout();
      this.showView(this.view);
      this.updateCursors();
      if (reshaped || from !== this.position) this.emitChange();
    }
    this.applyChrome();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.abandonFlight();
    this.destroyed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const entry of this.painted.values()) this.unpaint(entry);
    this.painted.clear();
    this.soft.destroy?.();
    this.listeners.clear();
    this.frame.remove();
  }

  /* -------------------------------------------------------------- layout */

  private shape(): Shape {
    return {
      sheets: Math.max(0, Math.trunc(this.options.sheets)),
      covers: this.options.covers,
      hard: this.options.hard,
    };
  }

  private shading() {
    return { shadow: this.options.shadow, gutter: this.options.gutter, lift: this.options.lift };
  }

  private makeSoft(): SheetRenderer {
    const soft = this.options.foldRenderer?.(this.doc, this.shading()) ?? new FoldingSheet(this.doc, this.shading());
    return soft;
  }

  private resolveLayout(): Layout {
    const wanted = this.options.layout;
    if (wanted !== "auto") return wanted;
    return this.spreadMedia && !this.spreadMedia.matches ? "single" : "spread";
  }

  private reducedMotion(): boolean {
    const wanted = this.options.reducedMotion;
    if (wanted !== "auto") return wanted;
    return this.calmMedia?.matches ?? false;
  }

  /** How thick the stack either side can get, which is room kept for it. */
  private reserve(): { before: number; after: number } {
    const sheets = this.shape().sheets;
    const most = stackWidths(sheets, sheets, sheets, Math.max(0, this.options.thickness));
    if (this.currentLayout !== "spread") return { before: 0, after: most.right };
    // Room beside each stack for a thumb to take a block of pages from it.
    const blocks = this.options.gestures && this.options.grabBlock && most.right > 0;
    const room = (width: number) => (blocks ? Math.max(width, BLOCK_ZONE) : width);
    return { before: room(most.left), after: room(most.right) };
  }

  private measure(): Size {
    const reserve = this.reserve();
    return computeSize({
      width: this.frame.clientWidth,
      height: this.options.fit === "contain" ? this.frame.clientHeight : Infinity,
      layout: this.currentLayout,
      binding: this.options.binding,
      pageRatio: this.options.pageRatio,
      reserveBefore: reserve.before,
      reserveAfter: reserve.after,
    });
  }

  private applyLayout(): void {
    const spread = this.currentLayout === "spread";
    const size = this.size;
    const reserve = this.reserve();
    const contain = this.options.fit === "contain";
    this.root.dataset.layout = this.currentLayout;
    this.root.dataset.binding = this.options.binding;

    this.frame.style.height = contain ? "100%" : `${size.displayHeight}px`;
    const top = contain ? Math.max(0, (this.frame.clientHeight - size.displayHeight) / 2) : 0;
    const shown = bookTransform(this.options.binding);
    Object.assign(this.root.style, {
      left: `${size.offset}px`,
      top: `${top}px`,
      width: `${size.bookWidth}px`,
      height: `${size.bookHeight}px`,
      transform: shown.transform,
      transformOrigin: shown.origin,
      // On a single page the sheet turning forward leaves the book over the
      // spine, where the facing page would be; there is no facing page, so it
      // is cut off at the book's edge rather than drawn over whatever is there.
      overflow: spread ? "visible" : "hidden",
    });

    this.cells.style.left = `${reserve.before}px`;
    for (const cell of [this.leftCell, this.rightCell]) {
      Object.assign(cell.style, {
        left: `${cell === this.rightCell && spread ? size.cellWidth : 0}px`,
        width: `${size.cellWidth}px`,
        height: `${size.cellHeight}px`,
      });
    }
    this.decorate(this.leftCell, this.leftGutter, this.holders?.left.page ?? null, "right");

    this.soft.setBinding?.(this.options.binding);
    for (const entry of this.painted.values()) this.placeContent(entry.el);
    const label = contentTransform(this.options.binding, 0, 0);
    this.blockLabel.style.transform = label.transform === "none" ? "" : label.transform;
    this.blockLabel.style.transformOrigin = "50% 50%";
    this.applyInput();
    this.drawStage();
  }

  /** Where each side's stack and grab zone are, and the book's slide. */
  private drawStage(progress?: number): void {
    const size = this.size;
    const spread = this.currentLayout === "spread";
    const reserve = this.reserve();
    const flight = this.flight;
    const along = progress ?? (flight && !flight.peek ? flight.progress : null);

    // The slide, eased from where the turn started to where it ends.
    const from = this.shiftFor(flight ? flight.plan.from : this.position);
    const to = this.shiftFor(flight ? flight.plan.to : this.position);
    const shift = along === null ? this.shiftFor(this.position) : from + (to - from) * along;
    this.stage.style.transform = shift ? `translateX(${shift.toFixed(2)}px)` : "";

    const turnedAt = (position: number) => Math.min(this.shape().sheets, Math.max(0, position + 1));
    const widths = (position: number) => {
      const sheets = this.shape().sheets;
      const turned = turnedAt(position);
      return stackWidths(turned, sheets - turned, sheets, Math.max(0, this.options.thickness));
    };
    let stack = widths(this.position);
    if (flight && along !== null) {
      const a = widths(flight.plan.from);
      const b = widths(flight.plan.to);
      stack = {
        left: a.left + (b.left - a.left) * along,
        right: a.right + (b.right - a.right) * along,
      };
    }
    const left = spread ? stack.left : 0;
    const right = stack.right;
    const pagesWidth = size.cellWidth * (spread ? 2 : 1);
    const taper = (width: number) => Math.min(3, width * 0.3).toFixed(2);

    Object.assign(this.stacks.left.style, {
      display: left > 0 ? "" : "none",
      left: `${reserve.before - left}px`,
      width: `${left}px`,
      height: `${size.cellHeight}px`,
      clipPath: `polygon(0 ${taper(left)}px, 100% 0, 100% 100%, 0 calc(100% - ${taper(left)}px))`,
    });
    Object.assign(this.stacks.right.style, {
      display: right > 0 ? "" : "none",
      left: `${reserve.before + pagesWidth}px`,
      width: `${right}px`,
      height: `${size.cellHeight}px`,
      clipPath: `polygon(0 0, 100% ${taper(right)}px, 100% calc(100% - ${taper(right)}px), 0 100%)`,
    });

    const blocks = this.options.gestures && this.options.grabBlock && this.options.thickness > 0;
    const zone = (width: number) => Math.max(BLOCK_ZONE, width);
    // Only on a spread: a phone's single page has no room beside it for a
    // thumb, and cuts off anything outside the page.
    const showLeft = blocks && spread && left > 0 && this.canPrev();
    const showRight = blocks && spread && right > 0 && this.canNext();
    Object.assign(this.handles.left.style, {
      display: showLeft ? "" : "none",
      left: `${reserve.before - zone(left)}px`,
      width: `${zone(left)}px`,
      height: `${size.cellHeight}px`,
    });
    Object.assign(this.handles.right.style, {
      display: showRight ? "" : "none",
      left: `${reserve.before + pagesWidth}px`,
      width: `${zone(right)}px`,
      height: `${size.cellHeight}px`,
    });
  }

  /** How far the pages slide for the view at a position. */
  private shiftFor(position: number): number {
    if (!this.options.center || this.currentLayout !== "spread") return 0;
    const pages = view(clampPosition(position, this.currentLayout, this.shape()), this.currentLayout, this.shape());
    const closed = !pages.left && pages.right ? "front" : pages.left && !pages.right ? "back" : null;
    return closedShift(closed, this.size.cellWidth);
  }

  private applyInput(): void {
    const top = this.options.binding === "top";
    // Sideways drags belong to the book, the other way to the page's scroll.
    this.root.style.touchAction = this.options.gestures ? (top ? "pan-x" : "pan-y") : "";
  }

  private applyChrome(): void {
    this.root.setAttribute("aria-label", this.options.label);
    if (this.options.keyboard) this.root.tabIndex = 0;
    else this.root.removeAttribute("tabindex");
    this.applyInput();
    // The gutters follow the gutter strength, and depend on the pages on show.
    this.decorate(this.leftCell, this.leftGutter, this.holders?.left.page ?? null, "right");
    this.decorate(this.rightCell, this.rightGutter, this.holders?.right.page ?? null, "left");
    this.updateCursors();
  }

  /**
   * An open hand where there is a page to pull, and only there: the inside
   * cover has nothing behind it, and neither has the last page.
   */
  private updateCursors(): void {
    const spread = this.currentLayout === "spread";
    const gestures = this.options.gestures;
    this.leftCell.style.cursor = gestures && spread && this.canPrev() ? "grab" : "";
    this.rightCell.style.cursor =
      gestures && (this.canNext() || (!spread && this.canPrev())) ? "grab" : "";
    this.drawStage();
  }

  /** Lays the book out again at the size of its container. */
  private resize(): void {
    const size = this.measure();
    const same =
      Math.abs(size.cellWidth - this.size.cellWidth) < 0.5 &&
      Math.abs(size.cellHeight - this.size.cellHeight) < 0.5 &&
      Math.abs(size.offset - this.size.offset) < 0.5;
    if (same && this.options.fit !== "contain") return;
    this.size = size;
    this.applyLayout();
    const flight = this.flight;
    if (flight) {
      // A turn carries on at the new size rather than being dropped.
      flight.grabY *= size.cellHeight / Math.max(1, flight.height);
      flight.width = size.cellWidth;
      flight.height = size.cellHeight;
      this.sheet.place(this.cellLeft(flight.plan.cell), flight.width, flight.height);
      this.drawFlight();
    }
    if (!same) this.emit("resize", { ...size });
  }

  /* --------------------------------------------------------------- pages */

  /** The page's own element, painted the first time it is needed. */
  private pageElement(page: PageRef): HTMLElement {
    const key = pageKey(page);
    let entry = this.painted.get(key);
    if (!entry) {
      const el = this.doc.createElement("div");
      el.className = "grabfold-content";
      el.dataset.page = key;
      el.style.position = "absolute";
      this.placeContent(el);
      entry = { el, cleanup: null, lastShown: 0 };
      this.painted.set(key, entry);
      this.paint(entry, page);
    }
    entry.lastShown = ++this.tick;
    return entry.el;
  }

  /** Turns a page's content back the right way round for the binding. */
  private placeContent(el: HTMLElement): void {
    const shown = contentTransform(this.options.binding, this.size.cellWidth, this.size.cellHeight);
    Object.assign(el.style, {
      left: "0",
      top: "0",
      width: shown.width,
      height: shown.height,
      transform: shown.transform === "none" ? "" : shown.transform,
      transformOrigin: shown.origin,
    });
  }

  private paint(entry: Painted, page: PageRef): void {
    const cleanup = this.options.render(entry.el, page);
    entry.cleanup = typeof cleanup === "function" ? cleanup : null;
  }

  private unpaint(entry: Painted): void {
    const cleanup = entry.cleanup;
    entry.cleanup = null;
    if (cleanup) cleanup();
    else entry.el.replaceChildren();
  }

  private pageFromKey(key: string): PageRef | null {
    const [kind, value, face] = key.split(":");
    if (kind === "cover") {
      return {
        kind: "cover",
        side: value === "back" ? "back" : "front",
        face: face === "outside" ? "outside" : "inside",
      };
    }
    if (kind === "front" || kind === "back") return { kind, sheet: Number(value) };
    return null;
  }

  /**
   * Puts a page in a holder, moving its element there if it is elsewhere.
   * Moving is all a turn ever does to a page: it is never painted again.
   */
  private put(holder: Holder, page: PageRef | null): void {
    holder.page = page;
    if (!page) {
      holder.el.replaceChildren();
      return;
    }
    const el = this.pageElement(page);
    if (holder.el.childNodes.length === 1 && holder.el.firstChild === el) return;
    holder.el.replaceChildren(el);
  }

  /** Lets go of pages long out of sight, keeping the few most recent. */
  private collect(): void {
    const shown = new Set(
      Object.values(this.holders)
        .map((holder) => (holder.page ? pageKey(holder.page) : null))
        .filter((key): key is string => key !== null),
    );
    const hidden = [...this.painted.entries()]
      .filter(([key]) => !shown.has(key))
      .sort((a, b) => b[1].lastShown - a[1].lastShown);
    for (const [key, entry] of hidden.slice(KEEP_HIDDEN)) {
      this.painted.delete(key);
      entry.el.remove();
      this.unpaint(entry);
    }
  }

  private showView(pages: View): void {
    this.put(this.holders.left, pages.left);
    this.put(this.holders.right, pages.right);
    this.decorate(this.leftCell, this.leftGutter, pages.left, "right");
    this.decorate(this.rightCell, this.rightGutter, pages.right, "left");
  }

  /**
   * A side with no page is not there at all — the left of a closed book —
   * rather than a blank page, and a cover's outside has no gutter.
   */
  private decorate(
    cell: HTMLDivElement,
    gutter: HTMLDivElement,
    page: PageRef | null,
    spine: "left" | "right",
  ): void {
    // Out of the layout altogether, not just unseen: slid across under a
    // closed book, an invisible page would still stick out past the page.
    const single = cell === this.leftCell && this.currentLayout === "single";
    cell.style.display = page && !single ? "" : "none";
    gutter.style.background = isOutside(page) ? "none" : gutterGradient(spine, this.options.gutter);
  }

  /* -------------------------------------------------------------- flight */

  /** A cell's left edge within the pages. */
  private cellLeft(cell: "left" | "right"): number {
    return cell === "right" && this.currentLayout === "spread" ? this.size.cellWidth : 0;
  }

  private begin(
    plan: FlightPlan,
    source: TurnEvent["source"],
    grabY: number,
    lift = 0,
    peek = false,
  ): void {
    const width = this.size.cellWidth;
    const height = this.size.cellHeight;

    // All in one go, before the next paint. The sheet starts exactly over the
    // page it lifts from, carrying that page's face, so the page swapping to
    // the destination underneath it is never seen.
    // A rigid leaf swings, a soft one folds: each has its own renderer, and
    // the faces go into whichever this turn uses.
    this.sheet = plan.hard ? this.rigid : this.soft;
    this.holders.resting.el = this.sheet.restingSlot;
    this.holders.turned.el = this.sheet.turnedSlot;
    this.sheet.setOutside(isOutside(plan.resting), isOutside(plan.turned));
    this.sheet.setFaces?.(plan.resting, plan.turned, plan.spine);

    // The leaf's faces first: the face that lifts is the very element that
    // was on the page a moment ago, moved, not a copy of it.
    this.put(this.holders.resting, plan.resting);
    this.put(this.holders.turned, plan.turned);
    this.showView(plan.under);
    this.sheet.place(this.cellLeft(plan.cell), width, height);
    this.flight = { plan, progress: 0, lift, grabY, width, height, source, peek };
    this.drawFlight();
    this.sheet.show();
    if (!peek) this.root.dataset.turning = "true";
    // Only peeking, the page is still the page: what is on it can be pointed
    // at and clicked, rather than the page hidden underneath it.
    this.sheet.restingSlot.style.pointerEvents = peek ? "auto" : "";
  }

  private drawFlight(): void {
    const flight = this.flight;
    if (!flight) return;
    const { plan } = flight;
    this.sheet.draw({
      spine: plan.spine,
      width: flight.width,
      height: flight.height,
      // A sheet arriving on a single page runs the fold backwards.
      progress: plan.arriving ? 1 - flight.progress : flight.progress,
      grabY: flight.grabY,
      lift: flight.lift,
    });
    if (!flight.peek) this.drawStage(flight.progress);
  }

  /**
   * Runs the fold from where it is now to flat on either side. `speed` is how
   * fast the hand was moving it, in progress per millisecond, towards `target`.
   */
  private settle(target: 0 | 1, speed = 0): Promise<boolean> {
    const flight = this.flight;
    if (!flight) return Promise.resolve(false);
    flight.peek = false;

    const from = flight.progress;
    const tilt = flight.lift;
    const duration = this.reducedMotion()
      ? 0
      : settleDuration(target - from, this.options.duration, speed);
    const event: TurnEvent = {
      direction: flight.plan.direction,
      from: flight.plan.from,
      to: flight.plan.to,
      duration,
      jump: flight.plan.jump,
      hard: flight.plan.hard,
      source: flight.source,
    };
    // Only a turn that goes through is heard or announced. A sheet let go
    // early drops back where it was, and nothing happened to the book.
    if (target === 1) {
      this.options.sound?.play(event);
      this.emit("turnstart", event);
    }

    const promise = new Promise<boolean>((resolve) => {
      this.resolveTurn = resolve;
    });
    const started = performance.now();

    const step = (now: number) => {
      const t = duration <= 0 ? 1 : Math.min(1, (now - started) / duration);
      const eased = easeOut(t);
      flight.progress = from + (target - from) * eased;
      // The tilt runs out as the sheet arrives: a page that has landed is
      // flat, and any crease left over would sit it askew.
      flight.lift = tilt * (1 - eased);
      this.drawFlight();

      if (t < 1) {
        this.frameRequest = this.win.requestAnimationFrame(step);
        return;
      }
      this.frameRequest = null;
      this.finish(target === 1 ? flight.plan.to : null);
      if (target === 1) {
        this.emit("turn", event);
        this.emitChange();
      }
    };
    this.frameRequest = this.win.requestAnimationFrame(step);
    return promise;
  }

  /**
   * Lands the sheet, or puts it back.
   *
   * In one synchronous go, so the pages under the sheet and the sheet itself
   * change in the same frame: the flat sheet is replaced by the identical page
   * it has become, and nothing blinks.
   */
  private finish(landedAt: number | null): void {
    if (landedAt !== null) this.raw = landedAt;
    this.hideBlockLabel();
    this.sheet.restingSlot.style.pointerEvents = "";
    // The face the sheet landed as moves onto the page it has become.
    this.showView(this.view);
    this.sheet.hide();
    this.put(this.holders.resting, null);
    this.put(this.holders.turned, null);
    this.collect();
    this.flight = null;
    delete this.root.dataset.turning;
    this.updateCursors();
    const resolve = this.resolveTurn;
    this.resolveTurn = null;
    resolve?.(landedAt !== null);
  }

  /** Stops a turn dead, leaving the book where it was. */
  private abandonFlight(): void {
    if (this.frameRequest !== null) {
      this.win.cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    this.stopPeekLoop();
    this.drag = null;
    delete this.root.dataset.dragging;
    if (this.flight) this.finish(null);
  }

  /* ----------------------------------------------------------------- peek */

  /** Eases a peeking page towards where the mouse wants it, a frame at a time. */
  private runPeek(): void {
    if (this.peekRequest !== null) return;
    const step = () => {
      this.peekRequest = null;
      const flight = this.flight;
      if (!flight?.peek) return;
      const target = this.peekTarget;
      flight.progress += (target.progress - flight.progress) * 0.22;
      flight.grabY += (target.grabY - flight.grabY) * 0.3;
      // Near a corner the corner lifts, pulled in towards the middle of the
      // page, rather than the whole edge: a dog-ear, not a strip.
      const reach = flight.progress / PEEK_MAX;
      flight.lift = (flight.height / 2 - flight.grabY) * 0.3 * reach;
      if (target.progress === 0 && flight.progress < 0.002) {
        this.finish(null);
        return;
      }
      this.drawFlight();
      this.peekRequest = this.win.requestAnimationFrame(step);
    };
    this.peekRequest = this.win.requestAnimationFrame(step);
  }

  private stopPeekLoop(): void {
    if (this.peekRequest !== null) {
      this.win.cancelAnimationFrame(this.peekRequest);
      this.peekRequest = null;
    }
  }

  /** Drops a peek at once. */
  private endPeek(): void {
    if (!this.flight?.peek) return;
    this.stopPeekLoop();
    this.finish(null);
  }

  /** A mouse moving over the book with no button down. */
  private hover(event: PointerEvent): void {
    const point = this.toBook(event.clientX, event.clientY);
    const onHandle = this.handleAt(event.target);
    if (onHandle) {
      this.showBlockLabel(onHandle, point.x, point.y);
      this.peekTarget.progress = 0;
      if (this.flight?.peek) this.runPeek();
      return;
    }
    this.hideBlockLabel();
    if (!this.options.gestures || !this.options.peek || this.reducedMotion()) return;
    if (this.routing || (this.flight && !this.flight.peek)) return;
    // Over a control — a button in the corner, a link — the page lies down,
    // so it can be used.
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) {
      if (this.flight?.peek) {
        this.peekTarget.progress = 0;
        this.runPeek();
      }
      return;
    }

    const width = this.size.cellWidth;
    const spread = this.currentLayout === "spread";
    const zone = Math.min(PEEK_ZONE, width * 0.18);
    const x = point.x;
    let direction: Direction | null = null;
    let distance = Infinity;
    if (spread && x >= 0 && x < width) {
      direction = "prev";
      distance = x;
    } else if (x >= (spread ? width : 0) && x <= (spread ? 2 : 1) * width) {
      direction = "next";
      distance = (spread ? 2 : 1) * width - x;
    }
    const progress = direction && point.y >= 0 && point.y <= this.size.cellHeight ? peekProgress(distance, zone) : 0;
    const allowed =
      direction !== null && progress > 0 && canTurn(this.position, direction, this.currentLayout, this.shape());

    const flight = this.flight;
    if (flight?.peek) {
      if (allowed && flight.plan.direction === direction) {
        this.peekTarget = { progress, grabY: point.y };
      } else {
        this.peekTarget.progress = 0;
      }
      this.runPeek();
      return;
    }
    if (!allowed || !direction) return;
    const plan = planFlight(
      this.position,
      this.position + (direction === "next" ? 1 : -1),
      this.currentLayout,
      this.shape(),
    );
    // Only a page lifting off the page on show peeks; one arriving from off
    // the edge of a phone would come in from nowhere.
    if (!plan || plan.arriving) return;
    this.begin(plan, "drag", point.y, 0, true);
    this.peekTarget = { progress, grabY: point.y };
    this.runPeek();
  }

  /* ---------------------------------------------------------------- block */

  private handleAt(target: EventTarget | null): "left" | "right" | null {
    if (target === this.handles.left) return "left";
    if (target === this.handles.right) return "right";
    return null;
  }

  /** How many steps a grab at a point on a stack's handle takes, and which way. */
  private blockAt(side: "left" | "right", x: number): { count: number; direction: Direction } {
    const spread = this.currentLayout === "spread";
    const pagesWidth = this.size.cellWidth * (spread ? 2 : 1);
    const handle = this.handles[side];
    const zone = parseFloat(handle.style.width) || BLOCK_ZONE;
    const depth = side === "right" ? (x - pagesWidth) / zone : -x / zone;
    const direction: Direction = side === "right" ? "next" : "prev";
    // A block runs up to the next rigid leaf, which only turns on its own.
    const far = direction === "next" ? lastPosition(this.currentLayout, this.shape()) : firstPosition(this.currentLayout, this.shape());
    const stops = route(this.position, far, this.currentLayout, this.shape());
    const available = stops.length ? Math.abs(stops[0] - this.position) : 0;
    const first = direction === "next" ? this.position + 1 : this.position;
    const count = isHardLeaf(first, this.shape()) ? Math.min(1, available) : blockCount(depth, available);
    return { count, direction };
  }

  private showBlockLabel(side: "left" | "right", x: number, y: number, block = this.blockAt(side, x)): void {
    if (block.count <= 0) {
      this.hideBlockLabel();
      return;
    }
    const pages = block.count * (this.currentLayout === "spread" ? 2 : 1);
    this.blockLabel.textContent = `${block.direction === "next" ? "+" : "−"}${pages}`;
    this.blockLabel.dataset.count = String(pages);
    const reserve = this.reserve();
    const pagesWidth = this.size.cellWidth * (this.currentLayout === "spread" ? 2 : 1);
    // Just inside the page's edge, where it cannot be cut off.
    const edge = side === "right" ? reserve.before + pagesWidth - 28 : reserve.before + 28;
    Object.assign(this.blockLabel.style, {
      display: "",
      left: `${edge}px`,
      top: `${Math.min(this.size.cellHeight - 12, Math.max(12, y))}px`,
      translate: "-50% -50%",
    });
  }

  private hideBlockLabel(): void {
    this.blockLabel.style.display = "none";
  }

  /* ------------------------------------------------------------- gestures */

  /** A point on screen in the pages' own coordinates: 0 0 is the first page's top left. */
  private toBook(clientX: number, clientY: number): { x: number; y: number } {
    const box = this.root.getBoundingClientRect();
    const scale = box.width / Math.max(1, this.size.displayWidth) || 1;
    const point = toBookPoint(
      (clientX - box.left) / scale,
      (clientY - box.top) / scale,
      this.options.binding,
      this.size.displayWidth,
    );
    const shift = this.shiftFor(this.position);
    return { x: point.x - this.reserve().before - shift, y: point.y };
  }

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      capture = false,
    ) => {
      this.root.addEventListener(type, handler, capture);
      this.cleanups.push(() => this.root.removeEventListener(type, handler, capture));
    };

    on("pointerdown", (event) => this.onPointerDown(event));
    on("pointermove", (event) => this.onPointerMove(event));
    on("pointerup", (event) => this.onPointerUp(event));
    on("pointercancel", (event) => this.onPointerUp(event));
    on("pointerleave", (event) => {
      if (event.pointerType !== "mouse" || this.drag) return;
      this.hideBlockLabel();
      if (this.flight?.peek) {
        this.peekTarget.progress = 0;
        this.runPeek();
      }
    });
    // A drag ends on a click, and that click is not a tap on whatever the
    // page holds. Caught on the way down, before the page's own handlers.
    on(
      "click",
      (event) => {
        if (!this.dragged) return;
        this.dragged = false;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    on("keydown", (event) => this.onKeyDown(event));
    // An image on a page would otherwise start the browser's own drag the
    // moment the pointer moved, and cancel the turn with it.
    on("dragstart", (event) => event.preventDefault());

    const onLayout = () => {
      const next = this.resolveLayout();
      if (next === this.currentLayout) return;
      this.abandonFlight();
      this.currentLayout = next;
      this.size = this.measure();
      this.applyLayout();
      this.applyChrome();
      this.showView(this.view);
      this.updateCursors();
      this.emit("layout", next);
      this.emitChange();
    };
    if (this.spreadMedia) {
      this.spreadMedia.addEventListener("change", onLayout);
      this.cleanups.push(() => this.spreadMedia?.removeEventListener("change", onLayout));
    }

    const Observer = (this.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (Observer) {
      // Laid out on the next frame, not inside the callback: laying out
      // changes the frame's own height, and a size changed while the observer
      // is delivering is reported as a loop.
      let request: number | null = null;
      const observer = new Observer(() => {
        if (request !== null) return;
        request = this.win.requestAnimationFrame(() => {
          request = null;
          if (!this.destroyed) this.resize();
        });
      });
      observer.observe(this.frame);
      this.cleanups.push(() => observer.disconnect());
    }
  }

  private onPointerDown(event: PointerEvent): void {
    // Cleared first and unconditionally: a drag that ended somewhere a click
    // never came would otherwise swallow the next genuine tap.
    this.dragged = false;
    const busy = this.routing || (this.flight !== null && !this.flight.peek);
    if (!this.options.gestures || busy || (event.pointerType === "mouse" && event.button !== 0)) {
      this.drag = null;
      return;
    }
    const point = this.toBook(event.clientX, event.clientY);
    const handle = this.handleAt(event.target);
    const block = handle ? this.blockAt(handle, point.x) : null;
    const width = this.size.cellWidth;
    this.drag = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      // Where on the page the sheet is taken hold of. Grab it high or low and
      // arc the hand, and the crease tilts the way paper does.
      grabY: Math.min(this.size.cellHeight, Math.max(0, point.y)),
      side:
        handle ?? (this.currentLayout === "spread" && point.x < width ? "left" : "right"),
      decided: false,
      base: 0,
      block: block && block.count > 0 ? block : null,
      samples: [],
    };
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) {
      if (!drag && event.pointerType === "mouse" && event.buttons === 0) this.hover(event);
      return;
    }
    const point = this.toBook(event.clientX, event.clientY);
    const { dx, dy } = { dx: point.x - drag.startX, dy: point.y - drag.startY };

    if (!drag.decided) {
      // A turn started from code while the button was down owns the sheet.
      if (this.flight && !this.flight.peek) {
        this.drag = null;
        return;
      }
      const direction = dragDirection(dx, dy, this.options.dragThreshold);
      if (!direction) return;
      if (drag.block && drag.block.direction !== direction) {
        this.drag = null;
        return;
      }
      const steps = drag.block?.count ?? 1;
      const peeking = this.flight?.peek ? this.flight : null;
      const adopt =
        peeking !== null && !drag.block && peeking.plan.direction === direction && steps === 1;
      if (peeking && !adopt) this.endPeek();

      const plan = adopt
        ? peeking.plan
        : (drag.block || dragAllowed(direction, drag.side, this.currentLayout)) &&
            canTurn(this.position, direction, this.currentLayout, this.shape())
          ? planFlight(
              this.position,
              this.position + (direction === "next" ? steps : -steps),
              this.currentLayout,
              this.shape(),
            )
          : null;
      if (!plan) {
        this.drag = null;
        return;
      }
      drag.decided = true;
      this.dragged = true;
      this.root.dataset.dragging = "true";
      try {
        // Keeps the drag alive if the pointer leaves the book. A convenience:
        // it throws if the pointer has already gone, and that must not take
        // the turn down with it.
        this.root.setPointerCapture(event.pointerId);
      } catch {
        // The drag still tracks while the pointer is over the book.
      }
      if (adopt && peeking) {
        // The hand takes over a page the mouse had lifted, from where it is.
        this.stopPeekLoop();
        peeking.peek = false;
        peeking.source = "drag";
        drag.base = peeking.progress;
        this.root.dataset.turning = "true";
        this.sheet.restingSlot.style.pointerEvents = "";
      } else {
        this.begin(plan, "drag", drag.grabY);
      }
      if (drag.block) {
        this.showBlockLabel(drag.side, point.x, point.y, drag.block);
      }
    }

    const flight = this.flight;
    if (!flight) return;
    const pagesWidth = this.size.cellWidth * (this.currentLayout === "spread" ? 2 : 1);
    const onwards = flight.plan.direction === "next" ? -dx : dx;
    flight.progress = Math.min(
      1,
      drag.base + dragProgress(Math.max(0, onwards), pagesWidth, this.currentLayout),
    );
    // Sideways carries the sheet over; up and down tilts the crease.
    flight.lift = dy;
    drag.samples.push({ time: event.timeStamp, progress: flight.progress });
    if (drag.samples.length > 24) drag.samples.splice(0, drag.samples.length - 24);
    // Pointer events can outrun the screen; draw at most once a frame.
    if (!this.pending) {
      this.pending = true;
      this.win.requestAnimationFrame(() => {
        this.pending = false;
        if (this.flight === flight && this.drag) this.drawFlight();
      });
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    delete this.root.dataset.dragging;
    if (!drag.decided || !this.flight) return;
    const progress = this.flight.progress;
    const speed = this.options.flick ? releaseSpeed(drag.samples) : 0;
    const target = this.options.flick
      ? releaseTarget(progress, speed, this.options.commitAt)
      : progress > this.options.commitAt
        ? 1
        : 0;
    // Only a hand moving the way the page is going carries on into the settle.
    const onwards = target === 1 ? Math.max(0, speed) : Math.max(0, -speed);
    void this.settle(target, onwards);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.options.keyboard || event.defaultPrevented) return;
    if (event.target !== this.root) return;
    let target: number | null = null;
    const turn = keyTurn(event.key, this.options.binding);
    if (turn === "next") target = this.position + 1;
    if (turn === "prev") target = this.position - 1;
    if (event.key === "Home") target = firstPosition(this.currentLayout, this.shape());
    // Past the end, which turnTo clamps to the last opening there is.
    if (event.key === "End") target = this.options.sheets + 1;
    if (target === null) return;
    event.preventDefault();
    void this.turnTo(target, "keyboard");
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
