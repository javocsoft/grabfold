export { Grabfold } from "./book.ts";
export type {
  ChangeEvent,
  FoldRenderer,
  GrabfoldEvents,
  GrabfoldOptions,
  RenderPage,
  TurnEvent,
  TurnSound,
} from "./book.ts";
export { FoldingSheet, gutterGradient } from "./sheet.ts";
export type { Shading, SheetFrame, SheetRenderer } from "./sheet.ts";
export type { Binding, Size } from "./space.ts";

export {
  ARRIVAL_SHARE,
  arrivalTime,
  easeOut,
  firstPosition,
  lastPosition,
} from "./model.ts";
export type { Direction, Layout, PageRef, Shape, View } from "./model.ts";

/** How a hand moves a page, as numbers: flicks, peeks, stacks and blocks. */
export {
  blockCount,
  closedShift,
  FLICK_SPEED,
  peekProgress,
  releaseSpeed,
  releaseTarget,
  settleDuration,
  stackWidths,
} from "./physics.ts";
export type { Sample } from "./physics.ts";

/**
 * The fold itself, for anyone drawing their own sheet — on a canvas, in WebGL,
 * anywhere. Pure functions: points in, points out.
 */
export { clipHalfPlane, foldDepth, foldGeometry, reflect } from "./geometry.ts";
export type { Fold, FoldInput, Point, Strip } from "./geometry.ts";
