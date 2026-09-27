import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockCount,
  closedShift,
  FLICK_SPEED,
  PEEK_MAX,
  peekProgress,
  releaseSpeed,
  releaseTarget,
  settleDuration,
  stackWidths,
} from "../src/physics.ts";

test("release speed is read from the last moments of a drag only", () => {
  const samples = [
    { time: 0, progress: 0 },
    { time: 500, progress: 0.05 }, // a slow start, long ago
    { time: 560, progress: 0.1 },
    { time: 590, progress: 0.13 },
  ];
  // Only the last 90 ms count: 0.08 over 90 ms.
  assert.ok(Math.abs(releaseSpeed(samples) - 0.08 / 90) < 1e-12);
});

test("a drag with one reading, or none, has no speed", () => {
  assert.equal(releaseSpeed([]), 0);
  assert.equal(releaseSpeed([{ time: 5, progress: 0.3 }]), 0);
});

test("a quick flick turns the page however little it was pulled", () => {
  assert.equal(releaseTarget(0.08, FLICK_SPEED * 2, 0.4), 1);
});

test("a flick back drops the page even past the commit point", () => {
  assert.equal(releaseTarget(0.7, -FLICK_SPEED * 2, 0.4), 0);
});

test("a twitch at the very start is not a flick", () => {
  assert.equal(releaseTarget(0.005, FLICK_SPEED * 5, 0.4), 0);
});

test("without speed, the distance decides", () => {
  assert.equal(releaseTarget(0.41, 0, 0.4), 1);
  assert.equal(releaseTarget(0.39, 0, 0.4), 0);
  assert.equal(releaseTarget(0.39, FLICK_SPEED / 2, 0.4), 0);
});

test("a settle without speed takes its share of a full turn", () => {
  assert.equal(settleDuration(0.5, 680), 340);
  assert.equal(settleDuration(-0.25, 680), 170);
});

test("a flicked page finishes sooner, but never in no time at all", () => {
  const stock = settleDuration(0.9, 680);
  const flicked = settleDuration(0.9, 680, 0.01);
  assert.ok(flicked < stock);
  assert.ok(flicked >= 120);
  // A slow hand never makes a turn take longer than it would have.
  assert.equal(settleDuration(0.9, 680, FLICK_SPEED), stock);
});

test("a peek lifts most at the edge and not at all outside its zone", () => {
  assert.ok(Math.abs(peekProgress(0, 60) - PEEK_MAX) < 1e-12);
  assert.equal(peekProgress(60, 60), 0);
  assert.equal(peekProgress(80, 60), 0);
  assert.equal(peekProgress(-1, 60), 0);
  assert.ok(peekProgress(10, 60) > peekProgress(30, 60));
});

test("stacks grow on the left and shrink on the right as the book is read", () => {
  const start = stackWidths(0, 100, 100, 10);
  const middle = stackWidths(50, 50, 100, 10);
  const end = stackWidths(100, 0, 100, 10);
  assert.deepEqual(start, { left: 0, right: 10 });
  assert.deepEqual(middle, { left: 5, right: 5 });
  assert.deepEqual(end, { left: 10, right: 0 });
});

test("a thin book is thinner, but a page left still shows", () => {
  const small = stackWidths(1, 7, 8, 10);
  assert.ok(small.right < 10);
  assert.ok(small.left >= 1, "one turned sheet is at least a pixel");
  assert.deepEqual(stackWidths(0, 0, 0, 10), { left: 0, right: 0 });
  assert.deepEqual(stackWidths(3, 3, 6, 0), { left: 0, right: 0 });
});

test("a closed book slides half a page towards the middle", () => {
  assert.equal(closedShift("front", 400), -200);
  assert.equal(closedShift("back", 400), 200);
  assert.equal(closedShift(null, 400), 0);
});

test("a block grab takes a couple at the surface and everything at the outside", () => {
  assert.equal(blockCount(0, 40), 2);
  assert.equal(blockCount(1, 40), 40);
  assert.equal(blockCount(2, 40), 40);
  assert.ok(blockCount(0.5, 40) < 20, "eased towards the few-pages end");
  assert.equal(blockCount(0.7, 1), 1);
  assert.equal(blockCount(0.7, 0), 0);
});
