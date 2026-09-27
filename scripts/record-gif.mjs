// Records docs/grabfold.gif, the animation at the top of the README: the
// plain JavaScript example driven by a scripted hand in Chromium, filmed by
// Playwright and turned into a GIF by ffmpeg with a palette of its own.
//
//   npm run gif        (needs ffmpeg on the PATH)
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const docs = resolve(root, "docs");
const raw = resolve(docs, "raw");
const port = 5198;
const size = { width: 900, height: 600 };

await mkdir(raw, { recursive: true });
const server = spawn(process.execPath, [resolve(root, "scripts/serve.mjs"), String(port)], { stdio: "ignore" });
await new Promise((done) => setTimeout(done, 500));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir: raw, size } });
const page = await context.newPage();
await page.goto(`http://localhost:${port}/examples/vanilla/`);
await page.waitForFunction(() => "book" in window);

// The film shows the book alone, and a hand where the mouse is: a video has
// no cursor of its own.
await page.addStyleTag({
  content: `
    .demo header, .controls, .jump, .sound, .strip { display: none !important; }
    .demo { padding-top: 40px; }
    #hand { position: fixed; z-index: 99; width: 26px; height: 26px; margin: -6px 0 0 -8px; pointer-events: none;
            background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9 11V5a1.5 1.5 0 0 1 3 0v5-6.5a1.5 1.5 0 0 1 3 0V10V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7S5 18.5 4 16l-1.6-3.3a1.4 1.4 0 0 1 2.4-1.4L7 14V7a1 1 0 0 1 2 0z' fill='white' stroke='black' stroke-width='1.3'/%3E%3C/svg%3E") no-repeat center / contain; }
    #hand.down { transform: scale(.85); }
  `,
});
await page.evaluate(() => {
  const hand = document.createElement("div");
  hand.id = "hand";
  document.body.append(hand);
  addEventListener("pointermove", (e) => Object.assign(hand.style, { left: `${e.clientX}px`, top: `${e.clientY}px` }), true);
  addEventListener("pointerdown", () => hand.classList.add("down"), true);
  addEventListener("pointerup", () => hand.classList.remove("down"), true);
});

// The pages themselves: the book's own box also holds room for the stacks,
// and a hand starting there would take a block of pages instead.
const box = await page.evaluate(() => {
  const size = window.book.dimensions;
  const outer = window.book.bookElement.getBoundingClientRect();
  const aside = (outer.width - size.cellWidth * 2) / 2;
  return { x: outer.left + aside, y: outer.top, width: size.cellWidth * 2, height: size.cellHeight };
});
const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
const pause = (ms) => page.waitForTimeout(ms);

/** A hand moving along a gentle curve, pressing where it is told to. */
async function stroke(points, { press = true, steps = 30, ms = 16 } = {}) {
  const [first, ...rest] = points;
  await page.mouse.move(...first, { steps: 8 });
  if (press) await page.mouse.down();
  for (let i = 0; i < rest.length; i += 1) {
    const from = i === 0 ? first : rest[i - 1];
    const to = rest[i];
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      await page.mouse.move(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
      await pause(ms);
    }
  }
  if (press) await page.mouse.up();
}

await page.mouse.move(...at(0.9, 0.95));
await pause(600);
// Open the hard cover.
await stroke([at(0.7, 0.55), at(0.45, 0.5), at(0.1, 0.5)]);
await pause(900);
// Take a page low, and arc the hand: the crease tilts.
await stroke([at(0.95, 0.85), at(0.7, 0.65), at(0.45, 0.45), at(0.05, 0.4)], { steps: 34 });
await pause(800);
// A peek at the corner, and a flick.
await stroke([at(0.8, 0.6), at(0.985, 0.93)], { press: false, steps: 14 });
await pause(700);
await stroke([at(0.985, 0.93), at(0.86, 0.9)], { steps: 5, ms: 10 });
await pause(1000);
// High this time, pulled back by the left page.
await stroke([at(0.06, 0.12), at(0.4, 0.3), at(0.95, 0.35)], { steps: 30 });
await pause(1200);

const video = page.video();
await context.close();
await browser.close();
server.kill();

const webm = resolve(docs, "grabfold.webm");
await rename(await video.path(), webm);
for (const file of await readdir(raw)) await rm(resolve(raw, file));
await rm(raw, { recursive: true });

// One palette for the whole film, then dithered onto it: a GIF looks as good
// as it can in 256 colours, and stays small.
const crop = `crop=${Math.round(box.width + 40)}:${Math.round(box.height + 40)}:${Math.round(box.x - 20)}:${Math.round(box.y - 20)}`;
const filters = `${crop},fps=15,scale=480:-1:flags=lanczos`;
const run = (args) => {
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
};
const palette = resolve(docs, "palette.png");
run(["-i", webm, "-vf", `${filters},palettegen=max_colors=96:stats_mode=diff`, palette]);
run(["-i", webm, "-i", palette, "-lavfi", `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, resolve(docs, "grabfold.gif")]);
await rm(palette);
console.log(`wrote ${resolve(docs, "grabfold.gif")}`);
