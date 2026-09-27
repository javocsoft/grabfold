// grabfold in plain JavaScript. Served from the repository, so it imports the
// built files directly; in a project of your own it is `import { Grabfold }
// from "grabfold"`.
import { Grabfold } from "../../dist/index.js";
import { createPageTurnSound } from "../../dist/sound.js";
import { defaultBoardTurnTakes, defaultPageTurnTakes } from "../../dist/sounds.js";
import { fullscreen, hashSync, thumbnails, zoom } from "../../dist/plugins.js";
import { SHEETS, describe, pageHTML } from "../shared/pages.js";

// The default page-turn sounds. Swap `takes` for your own recordings:
//   takes: [{ src: "/sounds/my-page.mp3", landsAt: 0.42 }]
const sound = createPageTurnSound({
  takes: defaultPageTurnTakes,
  // Heavier sounds for the hard covers.
  boardTakes: defaultBoardTurnTakes,
  volume: 0.7,
});
// Decoded ahead, so the first turn is heard on time.
void sound.preload();

const where = document.getElementById("where");
const prev = document.getElementById("prev");
const next = document.getElementById("next");
const jump = document.getElementById("jump");

const book = new Grabfold(document.getElementById("book"), {
  sheets: SHEETS,
  pageRatio: 3 / 4,
  // Real covers: the book starts closed, and the covers turn as rigid boards.
  covers: "hard",
  label: "A little book of colours",
  // Paint a page. Nothing is returned, so grabfold empties the element itself
  // before it is given another page.
  render(slot, page) {
    slot.innerHTML = pageHTML(page);
  },
  sound,
  onTurn: update,
  onLayoutChange: update,
});

document.getElementById("covers").addEventListener("change", (event) => {
  book.setOptions({ covers: event.target.value });
  book.jumpTo(-2);
  update();
});

document.getElementById("sound-on").addEventListener("change", (event) => {
  sound.muted = !event.target.checked;
});
document.getElementById("volume").addEventListener("input", (event) => {
  sound.volume = Number(event.target.value);
});

for (const [id, option, read] of [
  ["binding", "binding", (el) => el.value],
  ["thickness", "thickness", (el) => Number(el.value)],
  ["peek", "peek", (el) => el.checked],
  ["flick", "flick", (el) => el.checked],
]) {
  document.getElementById(id).addEventListener("input", (event) => {
    book.setOptions({ [option]: read(event.target) });
  });
}

// The plugins: a strip of thumbnails (painted small from the same HTML),
// zoom (double-click, pinch, Ctrl + wheel), fullscreen, and the address bar
// following the page.
thumbnails(book, document.getElementById("strip"), {
  height: 64,
  render(slot, page) {
    const inner = document.createElement("div");
    inner.innerHTML = pageHTML(page);
    const { cellWidth, cellHeight } = book.dimensions;
    Object.assign(inner.style, {
      width: `${cellWidth}px`,
      height: `${cellHeight}px`,
      transform: `scale(${64 / cellHeight})`,
      transformOrigin: "0 0",
      pointerEvents: "none",
    });
    slot.append(inner);
  },
});
zoom(book);
const screen = fullscreen(book);
document.getElementById("full").addEventListener("click", () => screen.toggle());
hashSync(book);
book.on("change", update);

// Exposed so the demo can be poked at from the browser's console.
window.book = book;

function update() {
  where.textContent = describe(book.view);
  prev.disabled = !book.canPrev();
  next.disabled = !book.canNext();
  jump.value = String(book.position);
}

prev.addEventListener("click", () => book.prev());
next.addEventListener("click", () => book.next());

// "Jump to" shows the riffle: several pages in one turn.
// From the closed book (-2) to closed again at the back (SHEETS). Without hard
// covers the ends are simply clamped to where that book can open.
for (let position = -2; position <= SHEETS; position += 1) {
  const option = document.createElement("option");
  option.value = String(position);
  option.textContent =
    position === -2
      ? "Cover"
      : position === -1
        ? "Page 1"
        : position === SHEETS - 1
          ? "Last pages"
          : position === SHEETS
            ? "Back cover"
            : `Pages ${position * 2 + 2}–${position * 2 + 3}`;
  jump.append(option);
}
jump.addEventListener("change", () => book.turnTo(Number(jump.value)));

update();
