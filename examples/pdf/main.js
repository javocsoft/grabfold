// A PDF as a book: pdf.js draws each page into a canvas, and that canvas is
// both the page on show and the image the WebGL curl is drawn from.
import * as pdfjs from "pdfjs-dist";
import { Grabfold } from "grabfold";
import { supportsWebGL, webglFold } from "grabfold/webgl";
import { fullscreen, hashSync, thumbnails, zoom } from "grabfold/plugins";
import { createPageTurnSound } from "grabfold/sound";
import { defaultPageTurnTakes } from "grabfold/sounds";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).href;

const pdf = await pdfjs.getDocument({ url: new URL("../sample.pdf", import.meta.url).href }).promise;
const count = pdf.numPages;
const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
document.getElementById("loading").remove();

/** Each PDF page drawn once, at a size that stays sharp when zoomed a little. */
const drawn = new Map();
function pageCanvas(index) {
  if (!drawn.has(index)) {
    drawn.set(
      index,
      pdf.getPage(index + 1).then(async (page) => {
        const width = Math.min(1600, Math.round(460 * Math.min(2, devicePixelRatio) * 1.5));
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement("canvas");
        canvas.className = "pdf";
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport }).promise;
        return canvas;
      }),
    );
  }
  return drawn.get(index);
}

/** No covers: the first sheet's front is PDF page 1, on the right. */
const indexOf = (page) => (page.kind === "cover" ? null : page.sheet * 2 + (page.kind === "back" ? 1 : 0));

const curl = supportsWebGL()
  ? webglFold({
      texture: (page) => {
        const index = indexOf(page);
        return index === null || index >= count ? null : pageCanvas(index);
      },
    })
  : undefined;

const sound = createPageTurnSound({ takes: defaultPageTurnTakes });
const where = document.getElementById("where");

const book = new Grabfold(document.getElementById("book"), {
  sheets: Math.ceil(count / 2),
  covers: "none",
  pageRatio: first.width / first.height,
  label: "A field guide to colours (PDF)",
  foldRenderer: curl,
  sound,
  render(slot, page) {
    const index = indexOf(page);
    if (index === null || index >= count) return;
    let gone = false;
    // The canvas is added when it is ready; until then the page is paper.
    void pageCanvas(index).then((canvas) => {
      if (!gone) slot.append(canvas);
    });
    return () => {
      gone = true;
      slot.replaceChildren();
    };
  },
});

const update = () => {
  const { left, right } = book.view;
  const numbers = [left, right].map((page) => (page ? indexOf(page) + 1 : null)).filter(Boolean);
  where.textContent = numbers.length ? `Page ${numbers.join("–")} of ${count}` : "";
  document.getElementById("prev").disabled = !book.canPrev();
  document.getElementById("next").disabled = !book.canNext();
};
book.on("change", update);
update();

document.getElementById("prev").onclick = () => book.prev();
document.getElementById("next").onclick = () => book.next();

// The extras: a strip of thumbnails, zoom, fullscreen, and the address bar.
thumbnails(book, document.getElementById("strip"), {
  height: 84,
  render(slot, page) {
    const index = indexOf(page);
    if (index === null || index >= count) return;
    const small = document.createElement("canvas");
    Object.assign(small.style, { width: "100%", height: "100%", display: "block" });
    void pageCanvas(index).then((canvas) => {
      small.width = 120;
      small.height = Math.round((120 * canvas.height) / canvas.width);
      small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
    });
    slot.append(small);
  },
});
zoom(book);
const screen = fullscreen(book);
document.getElementById("full").onclick = () => screen.toggle();
hashSync(book);

document.getElementById("curl").disabled = !curl;
document.getElementById("curl").onchange = (event) =>
  book.setOptions({ foldRenderer: event.target.checked ? curl : null });
document.getElementById("sound-on").onchange = (event) => (sound.muted = !event.target.checked);

window.book = book;
