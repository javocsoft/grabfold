import assert from "node:assert/strict";
import { test } from "node:test";
import { foldGeometry, reflect } from "../src/geometry.ts";
import { curlPoint } from "../src/webgl.ts";

const close = (a: number, b: number, why: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${why}: expected ${b}, got ${a}`);

const fold = foldGeometry({ spine: "left", width: 400, height: 600, progress: 0.4, grabY: 150, lift: 60 });
const { through, normal } = fold.crease;

test("the crease is a unit normal through the fold's midpoint", () => {
  close(Math.hypot(normal.x, normal.y), 1, "unit length");
  // The free edge, where the page was taken hold of, is on the carried side.
  const grab = { x: 400, y: 150 };
  assert.ok((grab.x - through.x) * normal.x + (grab.y - through.y) * normal.y < 0);
});

test("a point well past the crease lands where folding flat would put it", () => {
  const radius = 30;
  const point = { x: 399, y: 140 };
  const curled = curlPoint(point, { through, normal, radius });
  const flat = reflect(point, through, normal);
  close(curled.x, flat.x, "x");
  close(curled.y, flat.y, "y");
  close(curled.z, 2 * radius, "lying on top, a diameter up");
  close(curled.angle, Math.PI, "face down");
});

test("the page short of the curl stays flat where it is", () => {
  const point = { x: 5, y: 300 };
  assert.deepEqual(curlPoint(point, { through, normal, radius: 30 }), { ...point, z: 0, angle: 0 });
});

test("with no radius the curl is the flat fold exactly", () => {
  const point = { x: 380, y: 500 };
  const curled = curlPoint(point, { through, normal, radius: 0 });
  const flat = reflect(point, through, normal);
  close(curled.x, flat.x, "x");
  close(curled.y, flat.y, "y");
  assert.equal(curled.z, 0);
});

test("round the cylinder the sheet rises smoothly and never stretches", () => {
  const radius = 40;
  // Walk across the curl along the normal, into the carried side.
  // Where the curl starts: a quarter-turn's length back from the crease.
  const start = { x: through.x + normal.x * (Math.PI * radius) / 2, y: through.y + normal.y * (Math.PI * radius) / 2 };
  let previous = curlPoint(start, { through, normal, radius });
  assert.equal(previous.z, 0);
  let arc = 0;
  const step = 0.5;
  for (let s = step; s < Math.PI * radius; s += step) {
    const at = { x: through.x - normal.x * (s - (Math.PI * radius) / 2), y: through.y - normal.y * (s - (Math.PI * radius) / 2) };
    const curled = curlPoint(at, { through, normal, radius });
    {
      arc += Math.hypot(curled.x - previous.x, curled.y - previous.y, curled.z - previous.z);
    }
    assert.ok(curled.z >= previous.z - 1e-9, "only ever rises round the curl");
    previous = curled;
  }
  // The length round the curl is the length of paper that went into it.
  assert.ok(Math.abs(arc - Math.PI * radius) < 2, `arc ${arc} vs ${Math.PI * radius}`);
});
