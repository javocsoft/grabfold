/**
 * How a page responds to a hand, as plain arithmetic.
 *
 * Everything the book decides from a gesture that is worth pinning down with a
 * test lives here: whether a flick turns the page, how fast the turn then
 * runs, how far a page lifts when the pointer only hovers near it, how thick
 * the stacks of pages either side are, where a closed book sits, and how many
 * pages a thumb takes when it grabs the edge of the block.
 */

/* ----------------------------------------------------------------- flick */

/** One reading of a drag: when, and how far the turn had got. */
export interface Sample {
  /** Milliseconds, from the event's own timestamp. */
  time: number;
  /** Progress of the turn, 0 to 1. */
  progress: number;
}

/** How far back a flick's speed is measured, in milliseconds. */
export const FLICK_WINDOW = 90;

/**
 * Faster than this, in progress per millisecond, and a let-go is a flick.
 *
 * About a full turn in 2.5 s: a deliberate drag is slower, a snap of the
 * wrist far faster.
 */
export const FLICK_SPEED = 0.0004;

/** A flick has to have started to turn the page, not merely to have twitched. */
export const FLICK_MIN_PROGRESS = 0.02;

/**
 * The turn's speed at the moment of letting go, in progress per millisecond,
 * from the readings of the last few tens of milliseconds. Positive is on
 * towards turning; negative is back.
 */
export function releaseSpeed(samples: readonly Sample[], window = FLICK_WINDOW): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = last;
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const sample = samples[index];
    if (last.time - sample.time > window) break;
    first = sample;
  }
  const elapsed = last.time - first.time;
  return elapsed > 0 ? (last.progress - first.progress) / elapsed : 0;
}

/**
 * Where a let-go sends the page: over (1) or back (0).
 *
 * A quick flick decides by its direction, however little of the way the page
 * had come — that is how a real page is flicked over. Otherwise it is the
 * distance, past `commitAt` or not.
 */
export function releaseTarget(progress: number, speed: number, commitAt: number): 0 | 1 {
  if (Math.abs(speed) >= FLICK_SPEED) {
    if (speed > 0 && progress >= FLICK_MIN_PROGRESS) return 1;
    if (speed < 0) return 0;
  }
  return progress > commitAt ? 1 : 0;
}

/**
 * How long the rest of a turn takes, in milliseconds.
 *
 * By default a full turn's worth, in proportion to what is left. A page sent
 * off with some speed keeps it: the rest runs no slower than the hand was
 * moving, so a flick finishes briskly instead of slowing to the stock pace.
 */
export function settleDuration(
  remaining: number,
  fullTurn: number,
  speed = 0,
  floor = 120,
): number {
  const stock = fullTurn * Math.abs(remaining);
  if (Math.abs(speed) < FLICK_SPEED || remaining === 0) return stock;
  // An ease-out covers its distance three times as fast at the start as on
  // average, so the rest can take three times distance over speed and still
  // leave at the speed the hand did.
  const matched = (3 * Math.abs(remaining)) / Math.abs(speed);
  return Math.max(Math.min(floor, stock), Math.min(stock, matched));
}

/* ------------------------------------------------------------------ peek */

/** How far a page lifts, at most, when the pointer hovers near its edge. */
export const PEEK_MAX = 0.06;

/**
 * How far a page lifts for a pointer hovering `distance` pixels in from its
 * free edge, within a zone `zone` pixels wide: most at the very edge, none at
 * the zone's inner side. It invites the hand without being in its way.
 */
export function peekProgress(distance: number, zone: number, max = PEEK_MAX): number {
  if (zone <= 0 || distance < 0 || distance > zone) return 0;
  const closeness = 1 - distance / zone;
  return max * closeness * closeness * (3 - 2 * closeness);
}

/* ------------------------------------------------------------- thickness */

/**
 * How thick each stack of pages is drawn, in pixels: those already turned on
 * the left, those still to come on the right.
 *
 * A thin book is thin, and a thick one only grows to `max`; a page or two
 * always shows at least a pixel, so the reader can see there is more.
 */
export function stackWidths(
  turned: number,
  remaining: number,
  total: number,
  max: number,
): { left: number; right: number } {
  if (total <= 0 || max <= 0) return { left: 0, right: 0 };
  // A hundred sheets fills the thickness. Fewer are thinner, but by the
  // square root: paper is not that thin, and a book of eight sheets that
  // showed eight per cent of an edge would show none.
  const full = max * Math.min(1, Math.sqrt(total / 100));
  const side = (count: number) =>
    count <= 0 ? 0 : Math.max(1, Math.round((full * count) / total));
  return { left: side(turned), right: side(remaining) };
}

/* ---------------------------------------------------------- closed book */

/**
 * How far to slide the pages so a closed book sits in the middle of a spread.
 *
 * Closed, a book is one page wide, and sitting on its own half of the space
 * it looks as if something is missing. Slid over by half a page it is
 * centred, and it slides back as it is opened.
 */
export function closedShift(
  closed: "front" | "back" | null,
  pageWidth: number,
): number {
  if (closed === "front") return -pageWidth / 2;
  if (closed === "back") return pageWidth / 2;
  return 0;
}

/* ----------------------------------------------------------------- block */

/**
 * How many sheets a thumb takes from the edge of the block.
 *
 * `depth` is how far into the grab zone the block was taken, 0 at the page's
 * own edge and 1 at the outside of the stack: a pinch at the surface takes a
 * couple, a grab from the outside takes the lot.
 */
export function blockCount(depth: number, available: number): number {
  if (available <= 0) return 0;
  if (available <= 2) return available;
  const share = Math.min(1, Math.max(0, depth));
  // Eased, so the few-pages end — the common case — gets the most room.
  return Math.max(2, Math.min(available, Math.round(2 + (available - 2) * share * share)));
}
