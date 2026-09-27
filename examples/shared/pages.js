// The demo book's content, shared by both examples: a little book of colours.
// Each sheet has a colour on its front and a ruled notes page on its back.

export const COLOURS = [
  { name: "Saffron", hex: "#e9a23b", line: "Warm as a lamp left on in the hall." },
  { name: "Tidewater", hex: "#2f8f8a", line: "The sea on a morning that has not decided yet." },
  { name: "Brick", hex: "#b4533a", line: "Every old street you have walked down at dusk." },
  { name: "Heather", hex: "#8e6fa8", line: "A hillside seen from a train, gone in a blink." },
  { name: "Moss", hex: "#6f8a3c", line: "Soft underfoot, and older than the path." },
  { name: "Harbour", hex: "#2e5d8c", line: "Deep water with a light at the end of it." },
  { name: "Clay", hex: "#c27b56", line: "What the potter's hands smell of." },
  { name: "Ink", hex: "#2b2d42", line: "The last page, before anything was written on it." },
];

export const SHEETS = COLOURS.length;

/** Printed page numbers: the first front is page 1. Covers have none. */
export function pageNumber(page) {
  if (page.kind === "front") return page.sheet * 2 + 1;
  if (page.kind === "back") return page.sheet * 2 + 2;
  return null;
}

const COVER_NAMES = {
  "front:outside": "Front cover",
  "front:inside": "Inside front cover",
  "back:inside": "Inside back cover",
  "back:outside": "Back cover",
};

/** What is open, in words: "Pages 3–4", "Page 5", "Front cover"... */
export function describe(view) {
  const numbers = [view.left, view.right].map((page) => (page ? pageNumber(page) : null));
  const [left, right] = numbers;
  if (left && right) return `Pages ${left}–${right}`;
  if (left || right) return `Page ${left ?? right}`;
  const cover = view.right ?? view.left;
  return cover ? COVER_NAMES[`${cover.side}:${cover.face}`] : "";
}

const escape = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** One page as HTML, for the plain JavaScript example. */
export function pageHTML(page) {
  if (page.kind === "cover") {
    if (page.face === "outside") {
      return page.side === "front"
        ? `<div class="page board outside">
             <p class="eyebrow">A little book of</p>
             <h2>Colours</h2>
             <p class="small">Take hold of the cover and open it</p>
           </div>`
        : `<div class="page board outside back">
             <p class="small">grabfold — a page-turn you can grab anywhere</p>
           </div>`;
    }
    return page.side === "front"
      ? `<div class="page endpaper">
           <div class="label">
             <p class="eyebrow">A little book of</p>
             <h2>Colours</h2>
             <p class="hint">Grab a page anywhere<br>and pull it across.</p>
           </div>
         </div>`
      : `<div class="page endpaper">
           <div class="label"><h2>The end</h2><p class="hint">Pull it back the other way.</p></div>
         </div>`;
  }
  const colour = COLOURS[page.sheet];
  const number = pageNumber(page);
  if (page.kind === "front") {
    return `<div class="page swatch">
        <div class="chip" style="background:${colour.hex}"></div>
        <h3>${escape(colour.name)}</h3>
        <p class="hex">${colour.hex}</p>
        <p class="line">${escape(colour.line)}</p>
        <span class="folio">${number}</span>
      </div>`;
  }
  return `<div class="page notes" style="--accent:${colour.hex}">
      <p class="eyebrow">Notes on ${escape(colour.name.toLowerCase())}</p>
      <div class="ruled"></div>
      <span class="folio">${number}</span>
    </div>`;
}
