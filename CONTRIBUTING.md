# Contributing to grabfold

Thanks for taking an interest. Bug reports, browser reports and pull requests
are all welcome.

## Reporting a bug

Please include the browser and device, what you did, what you expected and what
happened. For anything visual, a screen recording helps more than a
description. Reports from **real phones and tablets, especially iOS**, are
particularly useful: the automated tests cover Chromium, Firefox and WebKit,
but only on desktop.

## Working on the code

```
npm install
npm run check      # typecheck, unit tests and build — run this before a pull request
npm run e2e        # the Playwright suite (run `npx playwright install` once first)
npm run demo       # try every example at http://localhost:5173/examples/
```

How the code is laid out:

- `src/geometry.ts` — the fold itself. Pure functions on points, no DOM.
- `src/model.ts` — which page goes where, and what a turn carries. Also pure.
- `src/sheet.ts` — draws a soft leaf mid-fold with plain DOM.
- `src/board.ts` — draws a rigid leaf mid-swing, in CSS 3D.
- `src/physics.ts` — flicks, peeks, stacks and blocks, as numbers. Pure.
- `src/space.ts` — sizing, and the transforms behind right and top bindings. Pure.
- `src/book.ts` — the `Grabfold` class: gestures, animation, pages, events.
- `src/webgl.ts` — the WebGL curl renderer (`grabfold/webgl`).
- `src/plugins.ts` — thumbnails, zoom, fullscreen, hash sync (`grabfold/plugins`).
- `src/react.tsx`, `src/vue.ts`, `src/svelte.ts`, `src/element.ts` — the adapters.
- `src/sound.ts` — the page-turn sound player (Web Audio).
- `src/sounds.ts` — the default sounds, embedded. Generated: do not edit it;
  see `scripts/sounds/`.

The pure modules are where the hard cases live, and they are tested in
`test/`. A change to how a page folds or which page shows where should come
with a test that pins it down. Anything a hand does — dragging, flicking,
peeking — belongs in `e2e/`, which drives the examples in real browsers. If a
change alters how a turn looks on purpose, delete the affected screenshot in
`e2e/__screenshots__/` and run `npm run e2e` to write a new one.

## Style

- TypeScript, strict. The sources must stay runnable by Node's type stripping,
  so only erasable syntax: no enums, no parameter properties, no namespaces.
- Comments explain *why*, not what — especially where a choice was made
  because the obvious alternative was tried and looked wrong.
- No runtime dependencies in the core.
