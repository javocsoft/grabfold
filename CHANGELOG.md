# Changelog

All notable changes to grabfold are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-09-27

First release, under the MIT licence.

### Added

- Framework-free core (`Grabfold`): pages that can be taken hold of anywhere
  and turned, with the crease following the hand and tilting with it.
- Paper geometry as pure, tested functions (`foldGeometry` and friends): the
  fold is the perpendicular bisector of the drag, the sheet never comes off
  the spine, and it lands square on the facing page.
- Book model of sheets with fronts and backs, optional inside covers, spread
  and single-page layouts switching on a media query.
- Jumps: turning several pages away as a single turn.
- Hard covers (`covers: "hard"`): covers that swing open as rigid boards,
  with the book starting closed and closing again at the back; and rigid
  sheets anywhere (`hard`), for board books. A jump across a rigid leaf is
  split into turns either side of it.
- Pages painted once and moved through a turn, never cloned.
- Keyboard turning, `prefers-reduced-motion`, an accessible book region.
- `onTurnStart` / `onTurn` events with the turn's remaining duration, and
  `arrivalTime()` for timing a sound to the landing.
- React adapter (`grabfold/react`): `GrabfoldBook`, controlled or not, with an
  imperative handle.
- Optional page-turn sounds: a `sound` option taking anything with a `play`
  method; `grabfold/sound` with `createPageTurnSound` (landing in sync, takes
  that never repeat, mirrored stereo going back, volume, mute, pitch
  variation, custom files, shared AudioContext, separate sounds for rigid
  leaves); and `grabfold/sounds` with synthesised default takes — three of
  paper, two of board — embedded, plus the MP3s and their generator.
- Gestures beyond the drag: a quick flick turns the page however short the
  pull, and finishes at the speed it was sent off with (`flick`); a page's
  corner peeks up as the mouse nears it, and becomes the drag when pressed
  (`peek`); a block of pages can be taken from the edge of a stack and turned
  at once, with a label saying how many (`grabBlock`). `gestures: false` for
  code and keys only.
- A book with a thickness: stacks of page edges either side, growing and
  shrinking as the book is read (`thickness`).
- A closed book, or any spread showing one page, slides to the middle and back
  as it opens (`center`).
- Bindings: right to left (`binding: "right"`) and along the top, turned
  upwards like a calendar (`binding: "top"`), with arrows and drags following.
- Sizing with `fit: "width" | "contain"`, laid out afresh as the container
  resizes.
- Events through `book.on(type, handler)`: `turnstart`, `turn`, `change`,
  `layout`, `resize`; and `viewAt`, `bounds`, `dimensions`, `element`,
  `bookElement`, `cancelDrag` on the book.
- `grabfold/webgl`: a real page curl on the GPU for books whose pages are
  images, landing exactly where the flat fold does; falls back to the DOM fold.
  Any `SheetRenderer` can be plugged in with `foldRenderer`.
- Adapters for Vue (`grabfold/vue`), Svelte (`grabfold/svelte`, an action) and
  a Web Component (`grabfold/element`, `<grab-fold>` with its children as the
  pages).
- `grabfold/plugins`: thumbnails, zoom and pan, fullscreen, and the address
  bar following the page.
- Examples in plain JavaScript, a Web Component, React, Vue, Svelte, a PDF read
  with pdf.js and curled in WebGL, a book of a thousand sheets, and a desk
  calendar; and a demo site with a configurator that writes the code.
- End-to-end tests in Playwright (Chromium, Firefox, and WebKit on CI), with
  screenshots of mid-turn frames.
