import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARRIVAL_SHARE,
  canTurn,
  clampPosition,
  dragAllowed,
  dragDirection,
  dragProgress,
  easeOut,
  firstPosition,
  lastPosition,
  leftRef,
  isHardLeaf,
  leafReverse,
  planFlight,
  rightRef,
  route,
  samePage,
  view,
  type PageRef,
  type Shape,
} from "../src/model.ts";

const BOOK: Shape = { sheets: 10, covers: "inside" };
const BARE: Shape = { sheets: 10, covers: "none" };
const HARD: Shape = { sheets: 10, covers: "hard" };

const front = (sheet: number): PageRef => ({ kind: "front", sheet });
const back = (sheet: number): PageRef => ({ kind: "back", sheet });
const insideFront: PageRef = { kind: "cover", side: "front", face: "inside" };
const insideBack: PageRef = { kind: "cover", side: "back", face: "inside" };
const outsideFront: PageRef = { kind: "cover", side: "front", face: "outside" };
const outsideBack: PageRef = { kind: "cover", side: "back", face: "outside" };

/* ---------------------------------------------------------------- range */

test("a spread opens on the inside front cover beside the first page", () => {
  assert.equal(firstPosition("spread", BOOK), -1);
  assert.deepEqual(view(-1, "spread", BOOK), { left: insideFront, right: front(0) });
});

test("a single page opens on the inside front cover, one step further back", () => {
  assert.equal(firstPosition("single", BOOK), -2);
  assert.deepEqual(view(-2, "single", BOOK), { left: null, right: insideFront });
  assert.deepEqual(view(-1, "single", BOOK), { left: null, right: front(0) });
});

test("with covers the last sheet turns onto the inside back cover", () => {
  assert.equal(lastPosition("spread", BOOK), 9);
  assert.deepEqual(view(9, "spread", BOOK), { left: back(9), right: insideBack });
  assert.deepEqual(view(9, "single", BOOK), { left: null, right: insideBack });
});

test("without covers the book starts and ends on real pages", () => {
  assert.equal(firstPosition("single", BARE), -1);
  assert.equal(lastPosition("spread", BARE), 8);
  assert.deepEqual(view(-1, "spread", BARE), { left: null, right: front(0) });
  assert.deepEqual(view(8, "spread", BARE), { left: back(8), right: front(9) });
});

test("a phone's cover opening reads as the spread's own opening", () => {
  // Turning a phone round on its cover must not lose the reader's place.
  assert.equal(clampPosition(-2, "spread", BOOK), -1);
  assert.equal(clampPosition(-2, "single", BOOK), -2);
});

test("positions outside the book are brought back into it", () => {
  assert.equal(clampPosition(99, "spread", BOOK), 9);
  assert.equal(clampPosition(-99, "single", BOOK), -2);
  assert.equal(clampPosition(Number.NaN, "spread", BOOK), -1);
  assert.equal(clampPosition(3.7, "spread", BOOK), 3);
});

test("a book of one sheet still opens", () => {
  const one: Shape = { sheets: 1, covers: "none" };
  assert.equal(firstPosition("spread", one), -1);
  assert.equal(lastPosition("spread", one), -1);
  assert.equal(canTurn(-1, "next", "spread", one), false);
});

test("an empty book has nothing to turn", () => {
  const none: Shape = { sheets: 0, covers: "none" };
  assert.equal(canTurn(-1, "next", "spread", none), false);
  assert.equal(canTurn(-1, "prev", "spread", none), false);
});

/* ---------------------------------------------------------------- pages */

test("a sheet's two sides are one leaf; a glued-down cover has no reverse", () => {
  assert.deepEqual(leafReverse(3, "front", BOOK), back(3));
  assert.deepEqual(leafReverse(3, "back", BOOK), front(3));
  assert.equal(leafReverse(-1, "front", BOOK), null);
  assert.equal(leafReverse(10, "front", BOOK), null);
});

test("pages are compared by what they are, not by identity", () => {
  assert.ok(samePage(front(2), front(2)));
  assert.ok(!samePage(front(2), back(2)));
  assert.ok(samePage(insideBack, { kind: "cover", side: "back", face: "inside" }));
  assert.ok(!samePage(insideBack, insideFront));
  assert.ok(!samePage(insideFront, outsideFront));
  assert.ok(samePage(null, null));
  assert.ok(!samePage(null, front(0)));
});

test("the sides for an index beyond either end fall to the covers", () => {
  assert.deepEqual(rightRef(-1, BOOK), insideFront);
  assert.deepEqual(rightRef(10, BOOK), insideBack);
  assert.deepEqual(leftRef(-1, BOOK), insideFront);
  assert.equal(rightRef(10, BARE), null);
  assert.equal(leftRef(10, BOOK), null);
});

/* -------------------------------------------------------------- flights */

test("turning forward on a spread lifts the right page onto the left", () => {
  const plan = planFlight(2, 3, "spread", BOOK);
  assert.ok(plan);
  assert.equal(plan.direction, "next");
  assert.equal(plan.cell, "right");
  assert.equal(plan.spine, "left");
  assert.equal(plan.arriving, false);
  assert.equal(plan.jump, false);
  // The sheet is the right-hand page's own leaf: its front lifts, its back lands.
  assert.deepEqual(plan.resting, front(3));
  assert.deepEqual(plan.turned, back(3));
  // Underneath, the left stays until covered and the right is already there.
  assert.deepEqual(plan.under, { left: back(2), right: front(4) });
});

test("turning back on a spread lifts the left page onto the right", () => {
  const plan = planFlight(2, 1, "spread", BOOK);
  assert.ok(plan);
  assert.equal(plan.cell, "left");
  assert.equal(plan.spine, "right");
  assert.deepEqual(plan.resting, back(2));
  assert.deepEqual(plan.turned, front(2));
  assert.deepEqual(plan.under, { left: back(1), right: front(3) });
});

test("an ordinary turn lands exactly the pages the book then shows", () => {
  for (const [from, to] of [
    [2, 3],
    [2, 1],
    [-1, 0],
    [9, 8],
  ]) {
    const plan = planFlight(from, to, "spread", BOOK);
    assert.ok(plan);
    const after = view(to, "spread", BOOK);
    // Whatever is under the sheet at the end, plus what it lands as, is the
    // new spread — nothing has to change on the last frame.
    const landedLeft = plan.direction === "next" ? plan.turned : plan.under.left;
    const landedRight = plan.direction === "next" ? plan.under.right : plan.turned;
    assert.ok(samePage(landedLeft, after.left), `left ${from}→${to}`);
    assert.ok(samePage(landedRight, after.right), `right ${from}→${to}`);
  }
});

test("a jump is one turn that lands the page it is going to", () => {
  const plan = planFlight(2, 7, "spread", BOOK);
  assert.ok(plan);
  assert.equal(plan.jump, true);
  // The page on show lifts...
  assert.deepEqual(plan.resting, front(3));
  // ...and the side it lays down is the destination's, not its own back.
  assert.deepEqual(plan.turned, back(7));
  assert.deepEqual(plan.under.right, front(8));
  const after = view(7, "spread", BOOK);
  assert.ok(samePage(plan.turned, after.left));
  assert.ok(samePage(plan.under.right, after.right));
});

test("a jump back lands the destination's right-hand page", () => {
  const plan = planFlight(7, 1, "spread", BOOK);
  assert.ok(plan);
  assert.deepEqual(plan.resting, back(7));
  assert.deepEqual(plan.turned, front(2));
  assert.deepEqual(plan.under.left, back(1));
});

test("a single page turns forward by lifting away the page on show", () => {
  const plan = planFlight(3, 4, "single", BOOK);
  assert.ok(plan);
  assert.equal(plan.cell, "right");
  assert.equal(plan.arriving, false);
  assert.deepEqual(plan.resting, front(4));
  assert.deepEqual(plan.turned, back(4));
  assert.deepEqual(plan.under, { left: null, right: front(5) });
});

test("a single page turns back by bringing the page back over it", () => {
  const plan = planFlight(4, 3, "single", BOOK);
  assert.ok(plan);
  assert.equal(plan.arriving, true);
  assert.equal(plan.spine, "left");
  // It ends lying flat showing the page it has come back to.
  assert.deepEqual(plan.resting, front(4));
  assert.deepEqual(plan.under, { left: null, right: front(5) });
});

test("lifting the cover off a phone's first page shows a plain reverse", () => {
  const plan = planFlight(-2, -1, "single", BOOK);
  assert.ok(plan);
  assert.deepEqual(plan.resting, insideFront);
  assert.equal(plan.turned, null);
  assert.deepEqual(plan.under.right, front(0));
});

test("there is no turn to where the book already is, or past its ends", () => {
  assert.equal(planFlight(3, 3, "spread", BOOK), null);
  assert.equal(planFlight(-1, -5, "spread", BOOK), null);
  assert.equal(planFlight(9, 12, "spread", BOOK), null);
  // Asked for too far, it goes as far as there is.
  assert.equal(planFlight(7, 99, "spread", BOOK)?.to, 9);
});

/* ------------------------------------------------------------------ drag */

test("only a clearly sideways press becomes a turn", () => {
  assert.equal(dragDirection(5, 0, 10), null);
  assert.equal(dragDirection(30, 40, 10), null);
  assert.equal(dragDirection(-30, 5, 10), "next");
  assert.equal(dragDirection(30, -5, 10), "prev");
});

test("a spread's pages can only be pulled away from the spine", () => {
  assert.ok(dragAllowed("next", "right", "spread"));
  assert.ok(dragAllowed("prev", "left", "spread"));
  assert.ok(!dragAllowed("prev", "right", "spread"));
  assert.ok(!dragAllowed("next", "left", "spread"));
  assert.ok(dragAllowed("prev", "right", "single"));
});

test("a drag across the book is a whole turn, a little sooner on a phone", () => {
  assert.equal(dragProgress(-400, 800, "spread"), 0.5);
  assert.equal(dragProgress(900, 800, "spread"), 1);
  assert.ok(dragProgress(-300, 400, "single") > dragProgress(-300, 400, "spread"));
  assert.equal(dragProgress(10, 0, "spread"), 0);
});

/* ------------------------------------------------------------------ time */

test("the landing share is where the ease-out is 95% of the way there", () => {
  assert.ok(Math.abs(easeOut(ARRIVAL_SHARE) - 0.95) < 1e-9);
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
});

/* ----------------------------------------------------------- hard covers */

test("with hard covers the book starts closed, on the front cover's outside", () => {
  assert.equal(firstPosition("spread", HARD), -2);
  assert.equal(firstPosition("single", HARD), -2);
  assert.deepEqual(view(-2, "spread", HARD), { left: null, right: outsideFront });
  assert.deepEqual(view(-2, "single", HARD), { left: null, right: outsideFront });
});

test("opening the cover shows its inside beside the first page", () => {
  assert.deepEqual(view(-1, "spread", HARD), { left: insideFront, right: front(0) });
});

test("and it closes again at the back, on the back cover's outside", () => {
  assert.equal(lastPosition("spread", HARD), 10);
  assert.deepEqual(view(9, "spread", HARD), { left: back(9), right: insideBack });
  assert.deepEqual(view(10, "spread", HARD), { left: outsideBack, right: null });
  // A phone shows that outside on its one page.
  assert.deepEqual(view(10, "single", HARD), { left: null, right: outsideBack });
});

test("a hard cover is one board: its two faces are each other's reverse", () => {
  assert.deepEqual(leafReverse(-1, "front", HARD), insideFront);
  assert.deepEqual(leafReverse(-1, "back", HARD), outsideFront);
  assert.deepEqual(leafReverse(10, "front", HARD), outsideBack);
});

test("the covers are rigid, and so is any sheet asked to be", () => {
  assert.ok(isHardLeaf(-1, HARD));
  assert.ok(isHardLeaf(10, HARD));
  assert.ok(!isHardLeaf(3, HARD));
  assert.ok(!isHardLeaf(-1, BOOK));
  const boardBook: Shape = { sheets: 4, covers: "none", hard: () => true };
  assert.ok(isHardLeaf(2, boardBook));
  assert.ok(!isHardLeaf(4, boardBook), "past the end is nothing");
});

test("opening a hard cover swings the board from the right onto the left", () => {
  const plan = planFlight(-2, -1, "spread", HARD);
  assert.ok(plan);
  assert.equal(plan.hard, true);
  assert.equal(plan.cell, "right");
  assert.deepEqual(plan.resting, outsideFront);
  assert.deepEqual(plan.turned, insideFront);
  // Nothing on the left while it swings over; the first page waits beneath.
  assert.deepEqual(plan.under, { left: null, right: front(0) });
});

test("closing the back cover swings it onto the left, leaving the right bare", () => {
  const plan = planFlight(9, 10, "spread", HARD);
  assert.ok(plan);
  assert.equal(plan.hard, true);
  assert.deepEqual(plan.resting, insideBack);
  assert.deepEqual(plan.turned, outsideBack);
  assert.deepEqual(plan.under, { left: back(9), right: null });
});

test("on a phone a board swings out of sight, so its far side is not asked for", () => {
  const open = planFlight(-2, -1, "single", HARD);
  assert.ok(open);
  assert.equal(open.hard, true);
  assert.equal(open.turned, null);
  assert.deepEqual(open.under.right, front(0));

  const close = planFlight(9, 10, "single", HARD);
  assert.ok(close);
  assert.deepEqual(close.resting, insideBack);
  assert.equal(close.turned, null);
  assert.deepEqual(close.under.right, outsideBack);
});

test("a turn never shows one page in two places at once", () => {
  const shapes = [BOOK, BARE, HARD, { sheets: 6, covers: "hard" as const, hard: (s: number) => s % 2 === 0 }];
  for (const shape of shapes) {
    for (const layout of ["spread", "single"] as const) {
      const first = firstPosition(layout, shape);
      const last = lastPosition(layout, shape);
      for (let from = first; from <= last; from++) {
        for (const to of [from - 1, from + 1]) {
          const plan = planFlight(from, to, layout, shape);
          if (!plan) continue;
          const pages = [plan.under.left, plan.under.right, plan.resting, plan.turned].filter(Boolean);
          for (let i = 0; i < pages.length; i++) {
            for (let j = i + 1; j < pages.length; j++) {
              assert.ok(!samePage(pages[i], pages[j]), `${shape.covers} ${layout} ${from}→${to}`);
            }
          }
        }
      }
    }
  }
});

test("a jump across a hard leaf is split around it", () => {
  // Closed, to the middle: open the cover, then riffle.
  assert.deepEqual(route(-2, 5, "spread", HARD), [-1, 5]);
  // And back: riffle to the cover, then close it.
  assert.deepEqual(route(5, -2, "spread", HARD), [-1, -2]);
  // Right through the book: cover, pages, back cover.
  assert.deepEqual(route(-2, 10, "spread", HARD), [-1, 9, 10]);
  // Soft all the way is a single jump.
  assert.deepEqual(route(-1, 7, "spread", BOOK), [7]);
  // A board book turns every leaf on its own.
  const board: Shape = { sheets: 4, covers: "none", hard: () => true };
  assert.deepEqual(route(-1, 2, "spread", board), [0, 1, 2]);
});

test("a jump never plans a rigid leaf as part of a riffle", () => {
  const plan = planFlight(-1, 5, "spread", HARD);
  assert.ok(plan);
  assert.equal(plan.jump, true);
  assert.equal(plan.hard, false);
});
