// Makes examples/pdf/sample.pdf: a short illustrated booklet, drawn here
// from nothing but HTML and CSS and printed with Playwright's Chromium, so
// the PDF example has something of our own to read.
//
//   node scripts/make-sample-pdf.mjs
import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const out = resolve(import.meta.dirname, "../examples/pdf/sample.pdf");

const PLATES = [
  ["Saffron", "#e9a23b", "Warm as a lamp left on in the hall."],
  ["Tidewater", "#2f8f8a", "The sea on a morning that has not decided yet."],
  ["Brick", "#b4533a", "Every old street you have walked down at dusk."],
  ["Heather", "#8e6fa8", "A hillside seen from a train, gone in a blink."],
  ["Moss", "#6f8a3c", "Soft underfoot, and older than the path."],
  ["Harbour", "#2e5d8c", "Deep water with a light at the end of it."],
  ["Clay", "#c27b56", "What the potter's hands smell of."],
  ["Ink", "#2b2d42", "The last page, before anything was written on it."],
];

const shapes = (hex, seed) =>
  Array.from({ length: 7 }, (_, i) => {
    const x = (seed * 37 + i * 53) % 90;
    const y = (seed * 17 + i * 29) % 70;
    const size = 18 + ((seed + i * 7) % 5) * 9;
    const round = i % 3 === 0 ? "50%" : i % 3 === 1 ? "6px" : "50% 0";
    return `<i style="left:${x}%;top:${y}%;width:${size}mm;height:${size}mm;border-radius:${round};background:${hex};opacity:${0.25 + (i % 4) * 0.18}"></i>`;
  }).join("");

const pages = [
  `<section class="title"><p>A field guide to</p><h1>Colours</h1><p class="by">printed for the grabfold PDF example</p></section>`,
  ...PLATES.flatMap(([name, hex, line], index) => [
    `<section class="plate"><div class="art">${shapes(hex, index + 1)}</div><h2>${name}</h2><p class="hex">${hex}</p><span class="folio">${index * 2 + 2}</span></section>`,
    `<section class="text"><h3>On ${name.toLowerCase()}</h3><p class="line">${line}</p>${"<p>Lorem ipsum is not used here; instead, a few honest lines about looking. Hold the page up to the light and the colour changes with the hour. Put it beside its neighbours and it changes again.</p>".repeat(3)}<span class="folio">${index * 2 + 3}</span></section>`,
  ]),
  `<section class="title end"><h1>Fin</h1></section>`,
];

const html = `<!doctype html><html><head><style>
@page { size: 150mm 200mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Georgia, serif; color: #2b2a27; }
section { width: 150mm; height: 200mm; padding: 16mm 14mm; position: relative; page-break-after: always; background: #fbf8f1; overflow: hidden; }
.title { display: grid; place-content: center; text-align: center; background: #1f4f5a; color: #f1e6c8; }
.title h1 { font-size: 30pt; margin: 4mm 0; } .title p { letter-spacing: .2em; text-transform: uppercase; font: 9pt system-ui; }
.title .by { opacity: .7; margin-top: 20mm; }
.plate .art { position: relative; height: 120mm; border-radius: 3mm; background: #f1ead9; overflow: hidden; }
.plate .art i { position: absolute; display: block; }
.plate h2 { font-size: 22pt; margin: 8mm 0 1mm; } .hex { font: 9pt system-ui; letter-spacing: .12em; color: #8f8878; }
.text h3 { font-size: 16pt; margin-top: 4mm; } .text .line { font-style: italic; font-size: 13pt; }
.text p { font-size: 10.5pt; line-height: 1.55; }
.folio { position: absolute; bottom: 8mm; left: 0; right: 0; text-align: center; font: 8pt system-ui; color: #9a9486; }
</style></head><body>${pages.join("")}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
await page.pdf({ path: out, width: "150mm", height: "200mm", printBackground: true });
await browser.close();
console.log(`wrote ${out}`);
