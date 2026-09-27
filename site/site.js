// The configurator: a live book, a panel of options, and the code for the
// book as it is set up, in whichever flavour you use.
import { Grabfold } from "./dist/index.js";
import { createPageTurnSound } from "./dist/sound.js";
import { defaultBoardTurnTakes, defaultPageTurnTakes } from "./dist/sounds.js";
import { SHEETS, describe, pageHTML } from "./examples/shared/pages.js";

/** The defaults, so the code only shows what was changed. */
const DEFAULTS = {
  covers: "inside",
  binding: "left",
  layout: "auto",
  pageRatio: 0.75,
  thickness: 10,
  duration: 680,
  shadow: 0.4,
  gutter: 0.3,
  lift: 45,
  gestures: true,
  peek: true,
  flick: true,
  grabBlock: true,
  center: true,
};
const NUMBERS = new Set(["pageRatio", "thickness", "duration", "shadow", "gutter", "lift"]);

const panel = document.getElementById("panel");
const sound = createPageTurnSound({ takes: defaultPageTurnTakes, boardTakes: defaultBoardTurnTakes });
void sound.preload();

function read() {
  const options = {};
  for (const key of Object.keys(DEFAULTS)) {
    const field = panel.elements.namedItem(key);
    options[key] = field.type === "checkbox" ? field.checked : NUMBERS.has(key) ? Number(field.value) : field.value;
    const out = panel.elements.namedItem(`${key}Out`);
    if (out) out.value = options[key];
  }
  return options;
}

const where = document.getElementById("where");
const prev = document.getElementById("prev");
const next = document.getElementById("next");
const update = () => {
  where.textContent = describe(book.view);
  prev.disabled = !book.canPrev();
  next.disabled = !book.canNext();
};

let options = read();
const book = new Grabfold(document.getElementById("book"), {
  ...options,
  sheets: SHEETS,
  label: "A little book of colours",
  render(slot, page) {
    slot.innerHTML = pageHTML(page);
  },
  sound,
});
book.on("change", update);
prev.onclick = () => book.prev();
next.onclick = () => book.next();
update();

panel.addEventListener("input", () => {
  const before = options;
  options = read();
  sound.muted = !panel.elements.namedItem("sound").checked;
  book.setOptions(options);
  // A book given hard covers starts closed; show it that way.
  if (before.covers !== options.covers) book.jumpTo(-2);
  update();
  showCode();
});

/* ------------------------------------------------------------------ code */

const changed = () =>
  Object.entries(options).filter(([key, value]) => DEFAULTS[key] !== value);

const value = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));
const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const flavours = {
  js: () => `import { Grabfold } from "grabfold";${soundImport()}

const book = new Grabfold(document.querySelector("#book"), {
  sheets: ${SHEETS},
${changed().map(([k, v]) => `  ${k}: ${value(v)},`).join("\n")}${changed().length ? "\n" : ""}  render(slot, page) {
    // page is { kind: "front" | "back", sheet } or { kind: "cover", side, face }
    slot.innerHTML = myPageHTML(page);
  },${soundOption()}
});

book.on("turn", (event) => console.log("now at", event.to));`,

  react: () => `import { GrabfoldBook } from "grabfold/react";${soundImport()}

export function Book() {
  return (
    <GrabfoldBook
      sheets={${SHEETS}}
${changed().map(([k, v]) => `      ${k}=${typeof v === "string" ? JSON.stringify(v) : `{${v}}`}`).join("\n")}${changed().length ? "\n" : ""}      renderPage={(page) => <MyPage page={page} />}${soundProp()}
    />
  );
}`,

  vue: () => `<script setup>
import { GrabfoldBook } from "grabfold/vue";${soundImport()}
</script>

<template>
  <GrabfoldBook
    :sheets="${SHEETS}"
${changed().map(([k, v]) => `    ${typeof v === "string" ? `${kebab(k)}="${v}"` : `:${kebab(k)}="${v}"`}`).join("\n")}${changed().length ? "\n" : ""}${panel.elements.namedItem("sound").checked ? '    :sound="sound"\n' : ""}  >
    <template #page="{ page }"><MyPage :page="page" /></template>
  </GrabfoldBook>
</template>`,

  element: () => `<script type="module" src="https://cdn.jsdelivr.net/npm/grabfold/dist/element.js"></script>

<grab-fold${changed()
    .map(([k, v]) =>
      typeof v === "boolean"
        ? v ? "" : `\n  no-${kebab(k)}`
        : `\n  ${kebab(k)}="${v}"`,
    )
    .join("")}>
  <div data-cover="front-inside">…</div>
  <div>Page 1</div>
  <div>Page 2</div>
  <!-- one child per page -->
  <div data-cover="back-inside">…</div>
</grab-fold>`,
};

function soundOn() {
  return panel.elements.namedItem("sound").checked;
}
function soundImport() {
  return soundOn()
    ? `
import { createPageTurnSound } from "grabfold/sound";
import { defaultPageTurnTakes, defaultBoardTurnTakes } from "grabfold/sounds";

const sound = createPageTurnSound({ takes: defaultPageTurnTakes, boardTakes: defaultBoardTurnTakes });`
    : "";
}
function soundOption() {
  return soundOn() ? "\n  sound," : "";
}
function soundProp() {
  return soundOn() ? "\n      sound={sound}" : "";
}

let tab = "js";
const code = document.getElementById("code");
function showCode() {
  code.textContent = flavours[tab]();
}
for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => {
    tab = button.dataset.tab;
    for (const other of document.querySelectorAll("[data-tab]")) {
      other.setAttribute("aria-selected", String(other === button));
    }
    showCode();
  });
}
document.getElementById("copy").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(code.textContent);
  event.target.textContent = "Copied";
  setTimeout(() => (event.target.textContent = "Copy"), 1200);
});
showCode();

window.book = book;
