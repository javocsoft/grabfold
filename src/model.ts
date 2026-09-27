/**
 * What a book shows, and what a turn carries, as plain data.
 *
 * No DOM here either. The book controller asks this module which page goes
 * where, and paints it; keeping the answers pure is what lets the awkward
 * cases — covers, a phone's single page, a jump of ten pages in one turn — be
 * tested rather than eyeballed.
 *
 * ## The model
 *
 * A book is a stack of **leaves**. Each has a **front**, read on the right,
 * and a **back**, which is what lands on the left once the leaf is turned. An
 * open spread shows the back of one leaf beside the front of the next —
 * exactly as paper does.
 *
 * The leaves are numbered by **sheet**, 0 to `sheets - 1`. Covers sit either
 * side of them, at -1 and at `sheets`, and there are three kinds:
 *
 * - `"none"`: no covers. The book starts on the first sheet's front.
 * - `"inside"`: only the covers' inner faces, glued down: the inside front
 *   cover is on the left before the first sheet is turned, the inside back
 *   cover on the right after the last.
 * - `"hard"`: real covers, boards that are turned like everything else but
 *   stay rigid. The book starts **closed**, showing the outside of the front
 *   cover, and closes again at the back.
 *
 * Any sheet can be made rigid too (`hard`), for board books and heavy albums.
 *
 * Where the book is open is its **position**: the index of the leaf whose
 * back is on the left, so -1 once nothing but the front cover has been turned.
 *
 * In the **single** layout, for narrow screens, only the right-hand side is on
 * show — the fronts. With covers the book opens one step further back, at -2,
 * so that the front cover is the first thing seen there too.
 */

export type Layout = "spread" | "single";
export type Direction = "next" | "prev";
export type Covers = "none" | "inside" | "hard";

/** One side of the book to paint. */
export type PageRef =
  | { kind: "front"; sheet: number }
  | { kind: "back"; sheet: number }
  | { kind: "cover"; side: "front" | "back"; face: "inside" | "outside" };

export interface Shape {
  /** How many sheets the book has. */
  sheets: number;
  covers: Covers;
  /** Which sheets are rigid. Hard covers are rigid regardless. */
  hard?: (sheet: number) => boolean;
}

/** What the two sides of the book show. `left` is always null when single. */
export interface View {
  left: PageRef | null;
  right: PageRef | null;
}

const cover = (side: "front" | "back", face: "inside" | "outside"): PageRef => ({
  kind: "cover",
  side,
  face,
});

/** Where the book can open, lowest first. */
export function firstPosition(layout: Layout, shape: Shape): number {
  if (shape.covers === "hard") return -2;
  return layout === "single" && shape.covers === "inside" ? -2 : -1;
}

/** Where the book can open, highest last. */
export function lastPosition(layout: Layout, shape: Shape): number {
  const last =
    shape.covers === "hard"
      ? shape.sheets // closed, showing the outside of the back cover
      : shape.covers === "inside"
        ? shape.sheets - 1 // the last sheet turned onto the inside back cover
        : shape.sheets - 2; // the last spread with a real page on its right
  return Math.max(firstPosition(layout, shape), last);
}

export function clampPosition(position: number, layout: Layout, shape: Shape): number {
  if (!Number.isFinite(position)) return firstPosition(layout, shape);
  return Math.min(
    lastPosition(layout, shape),
    Math.max(firstPosition(layout, shape), Math.trunc(position)),
  );
}

/** The front face of a leaf: what it shows on the right. */
export function rightRef(leaf: number, shape: Shape): PageRef | null {
  if (leaf >= 0 && leaf < shape.sheets) return { kind: "front", sheet: leaf };
  if (leaf === -1) {
    if (shape.covers === "hard") return cover("front", "outside");
    if (shape.covers === "inside") return cover("front", "inside");
  }
  if (leaf === shape.sheets && shape.covers !== "none") return cover("back", "inside");
  return null;
}

/** The back face of a leaf: what it shows on the left once turned. */
export function leftRef(leaf: number, shape: Shape): PageRef | null {
  if (leaf >= 0 && leaf < shape.sheets) return { kind: "back", sheet: leaf };
  if (leaf === -1 && shape.covers !== "none") return cover("front", "inside");
  if (leaf === shape.sheets && shape.covers === "hard") return cover("back", "outside");
  return null;
}

/**
 * The other face of a leaf, as seen when it is lifted by the given face.
 *
 * A sheet's front and back are one piece of paper, and a hard cover's inside
 * and outside are one board. An inside cover alone is glued to its board,
 * whose outside is not part of the book, so it has no reverse to show.
 */
export function leafReverse(leaf: number, lifted: "front" | "back", shape: Shape): PageRef | null {
  const insideOnly = (leaf === -1 || leaf === shape.sheets) && shape.covers !== "hard";
  if (insideOnly) return null;
  return lifted === "front" ? leftRef(leaf, shape) : rightRef(leaf, shape);
}

/** Whether a leaf turns as a rigid board rather than folding. */
export function isHardLeaf(leaf: number, shape: Shape): boolean {
  if (leaf === -1 || leaf === shape.sheets) return shape.covers === "hard";
  return leaf >= 0 && leaf < shape.sheets && (shape.hard?.(leaf) ?? false);
}

export function view(position: number, layout: Layout, shape: Shape): View {
  if (layout === "spread") {
    return { left: leftRef(position, shape), right: rightRef(position + 1, shape) };
  }
  // Closed at the back on a phone: the back cover's outside, which a spread
  // shows on the left, is the only side there is to show.
  if (shape.covers === "hard" && position === shape.sheets) {
    return { left: null, right: leftRef(position, shape) };
  }
  return { left: null, right: rightRef(position + 1, shape) };
}

export function canTurn(
  position: number,
  direction: Direction,
  layout: Layout,
  shape: Shape,
): boolean {
  return direction === "next"
    ? position < lastPosition(layout, shape)
    : position > firstPosition(layout, shape);
}

export function samePage(a: PageRef | null, b: PageRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "cover") {
    const other = b as typeof a;
    return a.side === other.side && a.face === other.face;
  }
  return a.sheet === (b as typeof a).sheet;
}

/**
 * Everything a turn needs to know before it starts.
 *
 * - `cell` is the side the moving leaf starts over, and `spine` the edge of
 *   that cell it is bound on.
 * - `arriving` is the one case that runs backwards: going back on a single
 *   page, the leaf does not lift off the page on show, it comes back over it
 *   from the spine, so it starts turned and ends flat.
 * - `hard` means the leaf is rigid: it swings round the spine as a board
 *   instead of folding.
 * - `under` is what the two sides show *beneath* the moving leaf for the
 *   whole turn — already where the book is heading, so the leaf lands on
 *   settled pages and nothing has to change under it on the last frame.
 * - `resting` is the face of the leaf that starts face up (for an arriving
 *   leaf, the face it ends on), and `turned` the face the turn carries over.
 */
export interface FlightPlan {
  direction: Direction;
  from: number;
  to: number;
  /** More than one step: the leaf that lands is not the one that lifted. */
  jump: boolean;
  hard: boolean;
  cell: "left" | "right";
  spine: "left" | "right";
  arriving: boolean;
  under: View;
  resting: PageRef | null;
  turned: PageRef | null;
}

/**
 * Plans a turn from one position to another, one step or many.
 *
 * A jump is still a single turn. The side that lifts is the page on show and
 * the side it lays down is the page it is going to, the way a thumb riffles a
 * block of pages over at once. A rigid leaf cannot be riffled with the rest —
 * `route` splits a jump around one — so a jump here is always soft.
 *
 * Returns null when there is nowhere to go.
 */
export function planFlight(
  from: number,
  to: number,
  layout: Layout,
  shape: Shape,
): FlightPlan | null {
  const target = clampPosition(to, layout, shape);
  if (target === from) return null;

  const direction: Direction = target > from ? "next" : "prev";
  const jump = Math.abs(target - from) > 1;
  // The leaf that moves: the one on the right going forward, the one on the
  // left (or, on a single page, the one coming back) going back.
  const leaf = direction === "next" ? from + 1 : from;
  const hard = !jump && isHardLeaf(leaf, shape);
  const base = { direction, from, to: target, jump, hard };
  const under = view(direction === "next" ? target : from, layout, shape);
  const after = view(target, layout, shape);

  if (layout === "spread") {
    if (direction === "next") {
      return {
        ...base,
        cell: "right",
        spine: "left",
        arriving: false,
        under: { left: leftRef(from, shape), right: under.right },
        resting: rightRef(from + 1, shape),
        turned: leftRef(target, shape),
      };
    }
    return {
      ...base,
      cell: "left",
      spine: "right",
      arriving: false,
      under: { left: after.left, right: rightRef(from + 1, shape) },
      resting: leftRef(from, shape),
      turned: rightRef(target + 1, shape),
    };
  }

  // On a single page the far side of a leaf only shows while it is folded
  // over the page. A rigid board swings off past the spine, out of sight, so
  // its far side is never seen and is not asked for.
  if (direction === "next") {
    const lifting = view(from, layout, shape).right;
    return {
      ...base,
      cell: "right",
      spine: "left",
      arriving: false,
      under: { left: null, right: after.right },
      resting: lifting,
      turned: hard ? null : leafReverse(leaf, "front", shape),
    };
  }
  const arriving = after.right;
  return {
    ...base,
    cell: "right",
    spine: "left",
    arriving: true,
    under: { left: null, right: view(from, layout, shape).right },
    resting: arriving,
    turned: hard ? null : leafReverse(target + 1, "front", shape),
  };
}

/**
 * The stops on the way from one position to another.
 *
 * Soft leaves are riffled over together, as one turn; a rigid leaf always
 * turns on its own, so a jump across one is split around it. Going from a
 * closed book to page 10 is the cover, then the pages.
 */
export function route(from: number, to: number, layout: Layout, shape: Shape): number[] {
  const target = clampPosition(to, layout, shape);
  const stops: number[] = [];
  if (target === from) return stops;

  let at = from;
  if (target > from) {
    for (let leaf = from + 1; leaf <= target; leaf += 1) {
      if (!isHardLeaf(leaf, shape)) continue;
      if (leaf - 1 > at) stops.push(leaf - 1);
      stops.push(leaf);
      at = leaf;
    }
    if (target > at) stops.push(target);
  } else {
    for (let leaf = from; leaf > target; leaf -= 1) {
      if (!isHardLeaf(leaf, shape)) continue;
      if (leaf < at) stops.push(leaf);
      stops.push(leaf - 1);
      at = leaf - 1;
    }
    if (target < at) stops.push(target);
  }
  return stops;
}

/* ------------------------------------------------------------------ drag */

/**
 * Which way a press is turning, once it has moved far enough to say.
 *
 * Only a clearly sideways movement counts, so a tap still reaches the page's
 * own content and a vertical swipe still scrolls.
 */
export function dragDirection(dx: number, dy: number, threshold: number): Direction | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? "next" : "prev";
}

/**
 * Whether a page taken hold of on one side may be pulled the given way.
 *
 * A page is bound at the spine, so it can only be pulled away from it: the
 * right-hand page turns forward and the left-hand one back. Pulling one the
 * other way is not a gesture a book has. On a single page there is only one
 * side, and it goes both ways.
 */
export function dragAllowed(direction: Direction, side: "left" | "right", layout: Layout): boolean {
  if (layout === "single") return true;
  return (direction === "next") === (side === "right");
}

/**
 * How far a drag has taken the turn, 0 to 1.
 *
 * The hand holds the page's free edge, and a full turn carries that edge
 * across two page widths: to the spine, then down the far side. On a spread
 * that is the width of the book, so the fold follows the finger exactly. On a
 * single page the same rule would want a swipe twice the screen wide, so there
 * the page is let run ahead of it.
 */
export function dragProgress(dx: number, bookWidth: number, layout: Layout): number {
  const travel = layout === "spread" ? bookWidth : bookWidth * 0.9;
  if (travel <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(dx) / travel));
}

/* ------------------------------------------------------------------ time */

/**
 * The curve a turn is run home on.
 *
 * Eased out only: on release the leaf is already moving, so easing in as well
 * would stall it at the moment it should be carrying on.
 */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * The share of a turn's running time by which the leaf has, to the eye,
 * landed.
 *
 * An ease-out spends its last third creeping the final few per cent, so the
 * page reads as down long before the animation ends. Worked out from the curve
 * above, for anyone timing something — a sound, say — to the landing.
 */
export const ARRIVAL_SHARE = 1 - Math.cbrt(1 - 0.95);

/** Milliseconds into a turn at which the leaf is seen to land. */
export function arrivalTime(durationMs: number): number {
  return ARRIVAL_SHARE * durationMs;
}
