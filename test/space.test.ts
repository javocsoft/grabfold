import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookTransform,
  computeSize,
  contentTransform,
  keyTurn,
  toBookDelta,
  toBookPoint,
  type SizeInput,
} from "../src/space.ts";

const base: SizeInput = {
  width: 800,
  height: Infinity,
  layout: "spread",
  binding: "left",
  pageRatio: 3 / 4,
  reserveBefore: 0,
  reserveAfter: 0,
};

test("a spread fills the width, two pages across", () => {
  const size = computeSize(base);
  assert.equal(size.cellWidth, 400);
  assert.equal(size.cellHeight, 400 / 0.75);
  assert.equal(size.displayWidth, 800);
  assert.equal(size.offset, 0);
});

test("room kept for the stacks comes out of the pages", () => {
  const size = computeSize({ ...base, reserveBefore: 10, reserveAfter: 10 });
  assert.equal(size.cellWidth, 390);
  assert.equal(size.bookWidth, 800);
});

test("contained, a book is limited by the height and centred across", () => {
  const size = computeSize({ ...base, height: 400 });
  assert.equal(size.cellHeight, 400);
  assert.equal(size.cellWidth, 300);
  assert.equal(size.offset, 100);
});

test("bound at the top, a spread is two pages stacked, each the given shape", () => {
  const size = computeSize({ ...base, binding: "top", pageRatio: 4 / 3 });
  // As seen: 800 wide, and each page 800 by 600, one above the other.
  assert.equal(size.displayWidth, 800);
  assert.ok(Math.abs(size.displayHeight - 1200) < 1e-9);
  // In the book's own space the pages sit side by side, turned.
  assert.ok(Math.abs(size.cellWidth - 600) < 1e-9);
  assert.equal(size.cellHeight, 800);
});

test("a top-bound book in a box fits the box's height", () => {
  const size = computeSize({ ...base, binding: "top", pageRatio: 4 / 3, height: 600 });
  assert.ok(size.displayHeight <= 600 + 1e-9);
  assert.ok(Math.abs(size.displayWidth / (size.displayHeight / 2) - 4 / 3) < 1e-9);
});

test("mirroring and transposing undo themselves, so pages read the right way", () => {
  assert.equal(bookTransform("left").transform, "none");
  assert.equal(bookTransform("right").transform, contentTransform("right", 1, 1).transform);
  assert.equal(bookTransform("top").transform, contentTransform("top", 1, 1).transform);
});

test("transposed content is laid out at the page's size as seen", () => {
  const shown = contentTransform("top", 600, 800);
  assert.equal(shown.width, "800px");
  assert.equal(shown.height, "600px");
});

test("points and movements come back into the book's own space", () => {
  assert.deepEqual(toBookPoint(10, 20, "left", 800), { x: 10, y: 20 });
  assert.deepEqual(toBookPoint(10, 20, "right", 800), { x: 790, y: 20 });
  assert.deepEqual(toBookPoint(10, 20, "top", 800), { x: 20, y: 10 });
  assert.deepEqual(toBookDelta(-5, 3, "right"), { dx: 5, dy: 3 });
  assert.deepEqual(toBookDelta(-5, 3, "top"), { dx: 3, dy: -5 });
});

test("the arrow keys follow the way the pages go", () => {
  assert.equal(keyTurn("ArrowRight", "left"), "next");
  assert.equal(keyTurn("ArrowLeft", "left"), "prev");
  assert.equal(keyTurn("ArrowLeft", "right"), "next");
  assert.equal(keyTurn("ArrowRight", "right"), "prev");
  assert.equal(keyTurn("ArrowDown", "top"), "next");
  assert.equal(keyTurn("ArrowUp", "top"), "prev");
  assert.equal(keyTurn("ArrowRight", "top"), null);
  assert.equal(keyTurn("PageDown", "right"), "next");
});
