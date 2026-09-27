/**
 * The geometry of a page caught mid-turn.
 *
 * A page does not pivot as a rigid plane hinged on the spine. It folds: a
 * crease forms and travels across the sheet, the part beyond it lies back on
 * the part before it, and the free edge moves at twice the speed of the crease
 * because it has to cover the same ground twice.
 *
 * Where the crease falls is not a choice. Take hold of the sheet at a point
 * and move that point somewhere else: the paper can only reach the new
 * position by folding about the **perpendicular bisector** of the two, because
 * every point of the crease has to stay the same distance from both. So the
 * crease is a straight line at an angle the drag decides, and holding the
 * sheet anywhere along its edge and arcing the hand tilts it, which is what a
 * page really does. That is the whole reason grabfold can let a page be taken
 * hold of anywhere rather than only by a corner.
 *
 * Everything here is pure arithmetic on points, with no DOM, so the
 * invariants that matter — that the sheet lands square on the facing page,
 * that the two halves stay joined at the crease, that the page never comes
 * off the spine — can be tested.
 */

export interface Point {
  x: number;
  y: number;
}

export interface FoldInput {
  /** The cell edge the sheet is bound on. */
  spine: "left" | "right";
  /** The page cell, in pixels, measured when the turn began. */
  width: number;
  height: number;
  /** 0 lying flat on its own page, 1 folded flat onto the facing one. */
  progress: number;
  /** How far down the free edge the sheet was taken hold of, in pixels. */
  grabY: number;
  /** How far the pointer has since strayed from that height, in pixels. */
  lift: number;
}

/** A band of shading lying along the crease and fading away from it. */
export interface Strip {
  /** Its near corner, in whichever coordinates it is drawn in. */
  x: number;
  y: number;
  /** Radians, for a CSS rotate with the origin at that corner. */
  angle: number;
  /** Across the strip: how far the shading reaches from the crease. */
  span: number;
  /** Along the strip, which has to outrun the page whatever the angle. */
  length: number;
}

export interface Fold {
  /** The part still lying flat, in cell coordinates. */
  leaf: Point[];
  /** What the fold has uncovered, in cell coordinates. */
  uncovered: Point[];
  /** The part folded over, in the folded face's own coordinates. */
  flap: Point[];
  /** Puts the folded face where the fold leaves it, with the origin at 0 0. */
  place: { x: number; y: number; angle: number };
  /** The roll of the crease, in the folded face's own coordinates. */
  roll: Strip;
  /** What the standing fold throws on the page, in cell coordinates. */
  cast: Strip;
  /**
   * The crease itself, in cell coordinates: a point on it, and the unit
   * normal pointing away from the part carried over. The sheet is folded
   * where `(p - through) · normal < 0`.
   */
  crease: { through: Point; normal: Point };
}

/** How far the shading reaches from the crease, as a share of a page width. */
const SHADOW_SPAN = 0.42;
/** The roll is the tighter of the two, the way it is in paper. */
const ROLL_SHARE = 0.75;
/**
 * The least the sheet is ever taken to have moved, in pixels.
 *
 * A sheet that has not moved at all has no crease and no direction to give
 * one, but it still has to be drawn: while a turn is running it is the only
 * thing covering the page it is uncovering. Returning nothing for the last
 * frames of an eased return left that page bare and showing through — a blink
 * of the wrong page. So the fold never vanishes; it shrinks to half a pixel
 * and waits to be taken off screen by the book.
 */
const LEAST_MOVE = 0.5;
/**
 * How far the crease may lean from upright, as a tangent — about 58 degrees.
 *
 * The spine already stops the sheet coming unbound, but it leaves one gesture
 * open: take hold of the very corner, where the binding is barely in the way,
 * and drag straight down. The corner swings round the spine on a short arc
 * and the page folds along its own length — real paper, but not a page turn.
 */
const MAX_LEAN = 1.6;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The part of a convex polygon where `side` is not negative.
 *
 * Sutherland and Hodgman: walk the edges, keep the points on the near side,
 * and wherever an edge crosses over, put a point exactly on the line. A
 * rectangle cut by one line comes back with at most five corners.
 */
export function clipHalfPlane(
  polygon: readonly Point[],
  side: (point: Point) => number,
): Point[] {
  const kept: Point[] = [];

  for (let index = 0; index < polygon.length; index++) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    const here = side(from);
    const there = side(to);

    if (here >= 0) kept.push(from);
    if (here >= 0 !== there >= 0) {
      const at = here / (here - there);
      kept.push({
        x: from.x + (to.x - from.x) * at,
        y: from.y + (to.y - from.y) * at,
      });
    }
  }

  return kept;
}

/** Mirrors a point across the line through `through` with the given normal. */
export function reflect(point: Point, through: Point, normal: Point): Point {
  const square = normal.x * normal.x + normal.y * normal.y;
  const over =
    ((point.x - through.x) * normal.x + (point.y - through.y) * normal.y) /
    square;
  return {
    x: point.x - 2 * over * normal.x,
    y: point.y - 2 * over * normal.y,
  };
}

/**
 * Lays a shading band along a line, fading away from it.
 *
 * The band is drawn with its own x running away from the crease and its own y
 * running along it, and it is started half its length back so it overshoots
 * the page at both ends however the crease is tilted.
 */
function strip(
  through: Point,
  normal: Point,
  span: number,
  length: number,
): Strip {
  const size = Math.hypot(normal.x, normal.y);
  // Away from the line, which is the side the shading falls on.
  const acrossX = -normal.x / size;
  const acrossY = -normal.y / size;
  // A CSS rotate sends the element's own y here, so the strip runs this way.
  const alongX = -acrossY;
  const alongY = acrossX;

  return {
    x: through.x - alongX * (length / 2),
    y: through.y - alongY * (length / 2),
    angle: Math.atan2(acrossY, acrossX),
    span,
    length,
  };
}

/**
 * Works out the fold.
 *
 * `progress` drives the horizontal journey and `lift` the tilt, so a turn run
 * from code — which has no pointer and so no lift — comes out as a plain
 * upright fold.
 */
export function foldGeometry(input: FoldInput): Fold {
  const { spine, width, height } = input;
  const progress = clamp(input.progress, 0, 1);

  // The sheet is taken hold of at the free edge and carried to the far side of
  // the spine, which is twice the width away: once to reach the spine, and
  // once more to come down the other side.
  const carried = Math.max(LEAST_MOVE, width * 2 * progress);
  const grab: Point = { x: spine === "left" ? width : 0, y: input.grabY };
  const reached = spine === "left" ? width - carried : carried;

  // The sheet is bound at the spine, and binding fixes distance: the point
  // being dragged can never get further from either end of the spine than it
  // already was. Hold to that and the crease can never cross the spine, which
  // is the one line on the page that has to stay put. Let it cross and the
  // whole sheet lifts off the middle of the book, which paper does not do.
  //
  // It also makes the tilt behave on its own. There is no room for one at
  // either end of the turn, so a page lands flat without being told to, and
  // very little room early on, where the smallest wobble would otherwise
  // throw the crease flat and fold the page along its length.
  const spineX = spine === "left" ? 0 : width;
  const gap = reached - spineX;
  const roomAt = (cornerY: number) => {
    const bound = Math.hypot(width, input.grabY - cornerY);
    return Math.sqrt(Math.max(0, bound * bound - gap * gap));
  };
  const fromTop = roomAt(0);
  const fromBottom = roomAt(height);

  const lean = MAX_LEAN * carried;
  const point: Point = {
    x: reached,
    y: clamp(
      input.grabY + input.lift,
      Math.max(-fromTop, height - fromBottom, input.grabY - lean),
      Math.min(fromTop, height + fromBottom, input.grabY + lean),
    ),
  };

  const normal: Point = { x: point.x - grab.x, y: point.y - grab.y };

  // The crease: every point on it is as far from where the sheet was held as
  // from where it now is.
  const middle: Point = {
    x: (grab.x + point.x) / 2,
    y: (grab.y + point.y) / 2,
  };

  const page: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  // Negative on the side the fold carries away, which is the grab's own side.
  const side = (at: Point) =>
    (at.x - middle.x) * normal.x + (at.y - middle.y) * normal.y;

  const leaf = clipHalfPlane(page, side);
  const uncovered = clipHalfPlane(page, (at) => -side(at));

  // The folded face is drawn to be read *after* the turn, so its own x runs
  // opposite the sheet's. Mirroring lines the two back up, and mirroring then
  // reflecting is a plain rotation, which is all CSS needs to be told.
  const mirror = (at: Point): Point => ({ x: width - at.x, y: at.y });
  const carry = (at: Point) => reflect(mirror(at), middle, normal);

  const origin = carry({ x: 0, y: 0 });
  const along = carry({ x: 1, y: 0 });

  const depth = Math.sin(Math.PI * progress);
  const span = SHADOW_SPAN * width * depth;
  const reach = 2 * Math.hypot(width, height);

  return {
    leaf,
    uncovered,
    flap: uncovered.map(mirror),
    place: {
      x: origin.x,
      y: origin.y,
      angle: Math.atan2(along.y - origin.y, along.x - origin.x),
    },
    // On the folded face the crease sits at the mirrored midpoint, and the
    // mirroring turns the normal's x about with it.
    roll: strip(
      mirror(middle),
      { x: -normal.x, y: normal.y },
      span * ROLL_SHARE,
      reach,
    ),
    cast: strip(middle, normal, span, reach),
    crease: {
      through: middle,
      normal: {
        x: normal.x / Math.hypot(normal.x, normal.y),
        y: normal.y / Math.hypot(normal.x, normal.y),
      },
    },
  };
}

/** How hard everything is shaded: flat at either end, deepest side on. */
export function foldDepth(progress: number): number {
  return Math.sin(Math.PI * clamp(progress, 0, 1));
}
