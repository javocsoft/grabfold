import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clipHalfPlane,
  foldGeometry,
  reflect,
  type Fold,
  type FoldInput,
  type Point,
} from "../src/geometry.ts";

const W = 360;
const H = 520;

function fold(over: Partial<FoldInput> = {}): Fold {
  const result = foldGeometry({
    spine: "left",
    width: W,
    height: H,
    progress: 0.5,
    grabY: H / 2,
    lift: 0,
    ...over,
  });
  assert.ok(result, "expected a fold");
  return result;
}

/** Puts a point of the folded face where CSS would put it. */
function placed(shape: Fold, point: Point): Point {
  const cos = Math.cos(shape.place.angle);
  const sin = Math.sin(shape.place.angle);
  return {
    x: shape.place.x + point.x * cos - point.y * sin,
    y: shape.place.y + point.x * sin + point.y * cos,
  };
}

function area(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function close(actual: number, expected: number, why: string): void {
  assert.ok(
    Math.abs(actual - expected) < 0.01,
    `${why}: expected ${expected}, got ${actual}`,
  );
}

test("a sheet that has not moved still covers its own page", () => {
  // It has to. While a turn is running it is the only thing over the page it
  // is uncovering, so a fold that gave up here would let that page show
  // through for the last frames of an eased return.
  const flat = fold({ progress: 0 });
  // Half a pixel of movement is kept so the crease still has a direction, so
  // a strip a quarter of a pixel wide is uncovered. Nobody is going to see it.
  assert.ok(area(flat.uncovered) / H < 0.5, "a sliver, at most");
  assert.ok(area(flat.leaf) / H > W - 0.5, "the page is covered");
  close(flat.place.angle, 0, "no crease to speak of");
});

test("dragged level, the crease stays upright", () => {
  const shape = fold({ progress: 0.3 });
  close(shape.place.angle, 0, "no tilt without lift");
  // The crease is upright at (1 - progress) of the way from the spine, so the
  // part still lying flat is that much of the page.
  close(area(shape.leaf), W * 0.7 * H, "flat remainder");
  close(area(shape.uncovered), W * 0.3 * H, "uncovered");
});

test("the fold puts the point held under the pointer", () => {
  for (const lift of [0, -90, 140]) {
    for (const progress of [0.15, 0.5, 0.85]) {
      const grabY = H * 0.25;
      const shape = fold({ progress, lift, grabY });
      // Where the sheet was taken hold of, in the folded face's own frame.
      const held = { x: W - W, y: grabY };
      const landed = placed(shape, held);
      close(landed.x, W * (1 - 2 * progress), `pointer x (${progress})`);
      // The binding can hold the sheet back, so the point held follows the
      // pointer as far as the spine allows and never past it.
      const asked = grabY + lift;
      assert.ok(
        Math.min(grabY, asked) - 0.01 <= landed.y &&
          landed.y <= Math.max(grabY, asked) + 0.01,
        `pointer y between ${grabY} and ${asked}, got ${landed.y}`,
      );
    }
  }
});

test("the two halves stay joined along the crease", () => {
  const shape = fold({ progress: 0.45, lift: 120, grabY: H * 0.3 });
  // Every corner the clip put on the crease is shared by both halves, so
  // carrying it over must leave it exactly where it was.
  const onCrease = shape.leaf.filter((point) =>
    shape.uncovered.some(
      (other) =>
        Math.abs(other.x - point.x) < 0.01 && Math.abs(other.y - point.y) < 0.01,
    ),
  );
  assert.ok(onCrease.length >= 2, "the crease should cross the page");

  for (const point of onCrease) {
    const carried = placed(shape, { x: W - point.x, y: point.y });
    close(carried.x, point.x, "crease x");
    close(carried.y, point.y, "crease y");
  }
});

test("a lift tilts the crease, and which way follows the drag", () => {
  const up = fold({ progress: 0.4, lift: -160 });
  const down = fold({ progress: 0.4, lift: 160 });
  assert.ok(Math.abs(up.place.angle) > 0.2, "dragging up should tilt");
  assert.ok(Math.abs(down.place.angle) > 0.2, "dragging down should tilt");
  close(up.place.angle, -down.place.angle, "mirrored lifts mirror the tilt");
});

/** Whether a point is inside a convex polygon, or on its edge. */
function holds(polygon: readonly Point[], point: Point): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross =
      (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 0.01) continue;
    const here = Math.sign(cross);
    if (sign !== 0 && here !== sign) return false;
    sign = here;
  }
  return true;
}

test("the sheet never comes off the spine, however wildly it is dragged", () => {
  for (const spine of ["left", "right"] as const) {
    const at = spine === "left" ? 0 : W;
    for (const grabY of [2, H * 0.3, H / 2, H - 2]) {
      for (const lift of [-2 * H, -H, -40, 40, H, 2 * H]) {
        for (const progress of [0.02, 0.2, 0.5, 0.8, 0.99, 1]) {
          const shape = fold({ spine, progress, grabY, lift });
          const where = `${spine} p=${progress} grabY=${grabY} lift=${lift}`;
          // Both ends of the spine have to stay on the half still lying flat.
          // If either crosses over, the crease has cut the binding and the
          // page floats away from the middle of the book.
          assert.ok(holds(shape.leaf, { x: at, y: 0 }), `spine top (${where})`);
          assert.ok(
            holds(shape.leaf, { x: at, y: H }),
            `spine bottom (${where})`,
          );
        }
      }
    }
  }
});

/** How far the crease leans off upright, in radians. */
function lean(shape: Fold): number {
  // The shading runs out of the crease at right angles to it, so its own
  // angle off horizontal is the crease's off vertical.
  return Math.abs(Math.atan(Math.tan(shape.cast.angle)));
}

test("the crease can only lean so far, however hard it is dragged", () => {
  const limit = Math.atan(1.6) + 0.01;
  for (const grabY of [1, H * 0.2, H / 2, H - 1]) {
    for (const progress of [0.01, 0.1, 0.3, 0.5, 0.75, 0.95]) {
      for (const lift of [-3 * H, 3 * H]) {
        const shape = fold({ progress, grabY, lift });
        assert.ok(
          lean(shape) <= limit,
          `leaned ${lean(shape)} at grabY=${grabY} p=${progress}`,
        );
      }
    }
  }
});

test("a page that has landed is flat, and leaning more asks for more", () => {
  // Nowhere left for a crease to go once the sheet is down on the far page.
  assert.ok(lean(fold({ progress: 0.998, lift: H })) < 0.02, "flat on landing");
  const little = fold({ progress: 0.4, lift: 40 });
  const lots = fold({ progress: 0.4, lift: 200 });
  assert.ok(lean(lots) > lean(little), "more lift, more lean");
});

test("the page is only ever divided, never lost or doubled", () => {
  for (const lift of [0, -200, 75]) {
    for (const progress of [0.1, 0.35, 0.6, 0.9]) {
      const shape = fold({ progress, lift, grabY: H * 0.7 });
      close(
        area(shape.leaf) + area(shape.uncovered),
        W * H,
        `halves add up (${progress}, ${lift})`,
      );
      close(
        area(shape.flap),
        area(shape.uncovered),
        "folding does not stretch the paper",
      );
    }
  }
});

test("a finished turn lands the sheet square on the facing page", () => {
  const shape = fold({ progress: 1 });
  close(shape.place.angle, 0, "no residual tilt");
  close(shape.place.x, -W, "one page to the left");
  close(shape.place.y, 0, "level");
  close(area(shape.leaf), 0, "nothing left lying flat");
  close(area(shape.uncovered), W * H, "the whole page has turned");
});

test("going back is the same fold the other way round", () => {
  const shape = fold({ spine: "right", progress: 1 });
  close(shape.place.angle, 0, "no residual tilt");
  close(shape.place.x, W, "one page to the right");
  close(area(shape.uncovered), W * H, "the whole page has turned");

  const part = fold({ spine: "right", progress: 0.3 });
  close(area(part.uncovered), W * 0.3 * H, "uncovered from the free edge");
});

test("the shading lies along the crease and falls off the folded side", () => {
  const shape = fold({ progress: 0.4, lift: 110, grabY: H * 0.4 });
  // The cast runs the other way from the roll: one falls on the page the fold
  // has uncovered, the other back across the fold itself.
  // The roll is drawn on the folded face, whose own x runs the other way, so
  // its angle comes out mirrored: pi minus the cast's.
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  close(
    wrap(shape.roll.angle),
    wrap(Math.PI - shape.cast.angle),
    "bands share the crease line",
  );
  assert.ok(shape.roll.span < shape.cast.span, "the roll is the tighter band");
  assert.ok(shape.cast.length > Math.hypot(W, H), "long enough to cross");
});

test("shading fades out at both ends of the turn", () => {
  assert.ok(fold({ progress: 0.001 }).cast.span < 1, "flat at the start");
  assert.ok(fold({ progress: 0.999 }).cast.span < 1, "flat at the end");
  assert.ok(fold({ progress: 0.5 }).cast.span > 150, "deepest side on");
});

test("clipping a square keeps the half asked for", () => {
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const left = clipHalfPlane(square, (p) => 6 - p.x);
  close(area(left), 60, "left of x = 6");
  const none = clipHalfPlane(square, (p) => -1 - p.x);
  close(area(none), 0, "nothing left");
});

test("reflecting twice puts a point back", () => {
  const through = { x: 3, y: 7 };
  const normal = { x: 2, y: -5 };
  const there = reflect({ x: 11, y: 4 }, through, normal);
  const back = reflect(there, through, normal);
  close(back.x, 11, "x");
  close(back.y, 4, "y");
});
