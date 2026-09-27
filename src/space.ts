/**
 * The book's own space, and how it is shown.
 *
 * All the geometry — the fold, the swing, the stacks — is worked out for one
 * kind of book: bound on the left, pages side by side. Other bindings are the
 * same book shown differently:
 *
 * - `"right"` — bound on the right, read right to left (manga, Arabic,
 *   Hebrew): the book mirrored left to right, with each page's content
 *   mirrored back so it still reads the right way round.
 * - `"top"` — bound along the top, turned upwards (wall calendars, notepads):
 *   the book transposed, swapping across and down, with each page's content
 *   transposed back.
 *
 * Mirroring and transposing are each their own inverse, which is what keeps
 * this small: the same transform takes the book to the screen and a page's
 * content back again, and pointer movement comes back through it too.
 */

import type { Layout } from "./model.ts";

export type Binding = "left" | "right" | "top";

export interface SizeInput {
  /** Room across, in pixels. */
  width: number;
  /** Room down, in pixels; Infinity when only the width constrains. */
  height: number;
  layout: Layout;
  binding: Binding;
  /** One page's width over its height, as shown. */
  pageRatio: number;
  /** Space kept either side of the pages, in the book's own across, for the stacks. */
  reserveBefore: number;
  reserveAfter: number;
}

export interface Size {
  /** One page in the book's own space. */
  cellWidth: number;
  cellHeight: number;
  /** The whole book in its own space, stacks included. */
  bookWidth: number;
  bookHeight: number;
  /** The whole book as shown. */
  displayWidth: number;
  displayHeight: number;
  /** Where it sits across the room, to be centred in it. */
  offset: number;
}

/**
 * The largest book that fits the room.
 *
 * In the book's own space a page is `cellWidth` across; bound at the top, the
 * page as shown is the other way round, so its own ratio is inverted there.
 */
export function computeSize(input: SizeInput): Size {
  const pages = input.layout === "spread" ? 2 : 1;
  const reserve = input.reserveBefore + input.reserveAfter;
  const top = input.binding === "top";
  const ratio = top ? 1 / input.pageRatio : input.pageRatio;
  const room = Math.max(0, input.width);
  const down = Number.isFinite(input.height) ? Math.max(0, input.height) : Infinity;

  const cellWidth = Math.max(
    0,
    top
      ? Math.min(room * ratio, (down - reserve) / pages)
      : Math.min((room - reserve) / pages, down * ratio),
  );
  const cellHeight = ratio > 0 ? cellWidth / ratio : 0;
  const bookWidth = pages * cellWidth + reserve;
  const bookHeight = cellHeight;
  const displayWidth = top ? bookHeight : bookWidth;
  const displayHeight = top ? bookWidth : bookHeight;
  return {
    cellWidth,
    cellHeight,
    bookWidth,
    bookHeight,
    displayWidth,
    displayHeight,
    offset: Math.max(0, (room - displayWidth) / 2),
  };
}

/** The CSS transform that shows the book's own space on screen. */
export function bookTransform(binding: Binding): { transform: string; origin: string } {
  if (binding === "right") return { transform: "scaleX(-1)", origin: "50% 50%" };
  if (binding === "top") return { transform: "matrix(0, 1, 1, 0, 0, 0)", origin: "0 0" };
  return { transform: "none", origin: "50% 50%" };
}

/**
 * The transform that puts a page's content back the right way round inside
 * the transformed book, and the size its box needs for that.
 */
export function contentTransform(
  binding: Binding,
  cellWidth: number,
  cellHeight: number,
): { transform: string; origin: string; width: string; height: string } {
  if (binding === "right") {
    return { transform: "scaleX(-1)", origin: "50% 50%", width: "100%", height: "100%" };
  }
  if (binding === "top") {
    // Laid out at the page's own size as shown, then transposed into the cell.
    return {
      transform: "matrix(0, 1, 1, 0, 0, 0)",
      origin: "0 0",
      width: `${cellHeight}px`,
      height: `${cellWidth}px`,
    };
  }
  return { transform: "none", origin: "50% 50%", width: "100%", height: "100%" };
}

/**
 * A point on screen, relative to the book's box as shown, in the book's own
 * space. `displayWidth` is that box's width.
 */
export function toBookPoint(
  x: number,
  y: number,
  binding: Binding,
  displayWidth: number,
): { x: number; y: number } {
  if (binding === "right") return { x: displayWidth - x, y };
  if (binding === "top") return { x: y, y: x };
  return { x, y };
}

/** A movement on screen, in the book's own space. */
export function toBookDelta(dx: number, dy: number, binding: Binding): { dx: number; dy: number } {
  if (binding === "right") return { dx: -dx, dy };
  if (binding === "top") return { dx: dy, dy: dx };
  return { dx, dy };
}

/**
 * Which way a key turns the book, or null. Onwards is the way the pages go:
 * right for a left binding, left for a right one, down for a top one.
 */
export function keyTurn(key: string, binding: Binding): "next" | "prev" | null {
  if (key === "PageDown") return "next";
  if (key === "PageUp") return "prev";
  const forward = binding === "right" ? "ArrowLeft" : binding === "top" ? "ArrowDown" : "ArrowRight";
  const back = binding === "right" ? "ArrowRight" : binding === "top" ? "ArrowUp" : "ArrowLeft";
  if (key === forward) return "next";
  if (key === back) return "prev";
  return null;
}
