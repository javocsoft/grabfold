// grabfold in React. Bundled by scripts/build-examples.mjs; in a project
// of your own it is `import { GrabfoldBook } from "grabfold/react"`.
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GrabfoldBook, type GrabfoldBookHandle, type PageRef } from "grabfold/react";
import { createPageTurnSound } from "grabfold/sound";
import { defaultBoardTurnTakes, defaultPageTurnTakes } from "grabfold/sounds";
import { COLOURS, SHEETS, pageNumber } from "../shared/pages.js";

/**
 * A page is ordinary React. This one even keeps its own state: grabfold never
 * clones a page, so the count survives being turned over and back.
 */
function Swatch({ sheet }: { sheet: number }) {
  const colour = COLOURS[sheet];
  const [likes, setLikes] = useState(0);
  return (
    <div className="page swatch">
      <div className="chip" style={{ background: colour.hex }} />
      <h3>{colour.name}</h3>
      <p className="hex">{colour.hex}</p>
      <p className="line">{colour.line}</p>
      <button type="button" className="like" onClick={() => setLikes((n) => n + 1)}>
        ♥ {likes}
      </button>
      <span className="folio">{pageNumber({ kind: "front", sheet })}</span>
    </div>
  );
}

function Page({ page }: { page: PageRef }) {
  if (page.kind === "cover") {
    if (page.face === "outside") {
      return page.side === "front" ? (
        <div className="page board outside">
          <p className="eyebrow">A little book of</p>
          <h2>Colours</h2>
          <p className="small">Take hold of the cover and open it</p>
        </div>
      ) : (
        <div className="page board outside back">
          <p className="small">grabfold — a page-turn you can grab anywhere</p>
        </div>
      );
    }
    return (
      <div className="page endpaper">
        <div className="label">
          {page.side === "front" ? (
            <>
              <p className="eyebrow">A little book of</p>
              <h2>Colours</h2>
              <p className="hint">Made with grabfold and React</p>
            </>
          ) : (
            <>
              <h2>The end</h2>
              <p className="hint">Pull it back the other way.</p>
            </>
          )}
        </div>
      </div>
    );
  }
  if (page.kind === "front") return <Swatch sheet={page.sheet} />;
  const colour = COLOURS[page.sheet];
  return (
    <div className="page notes" style={{ ["--accent" as string]: colour.hex }}>
      <p className="eyebrow">Notes on {colour.name.toLowerCase()}</p>
      <div className="ruled" />
      <span className="folio">{pageNumber(page)}</span>
    </div>
  );
}

function App() {
  const book = useRef<GrabfoldBookHandle>(null);
  // Controlled: the book follows this, and reports back when a drag lands.
  const [position, setPosition] = useState(-2);
  const [turns, setTurns] = useState(0);
  // One player for the life of the page. Its volume and mute are plain
  // properties, so changing them needs no new player and no re-render of the book.
  const [sound] = useState(() =>
    createPageTurnSound({ takes: defaultPageTurnTakes, boardTakes: defaultBoardTurnTakes }),
  );
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState(0.7);
  useEffect(() => {
    void sound.preload();
    return () => sound.dispose();
  }, [sound]);
  useEffect(() => {
    sound.muted = !soundOn;
    sound.volume = volume;
  }, [sound, soundOn, volume]);

  return (
    <main className="demo">
      <header>
        <h1>grabfold + React</h1>
        <p>
          Take hold of a page <strong>anywhere</strong> and pull it across. The pages are React
          components — tap a heart, turn the page over and back, and it is still counted.
        </p>
      </header>

      <GrabfoldBook
        ref={book}
        className="book"
        sheets={SHEETS}
        pageRatio={3 / 4}
        covers="hard"
        label="A little book of colours"
        position={position}
        onPositionChange={setPosition}
        sound={sound}
        onTurn={() => setTurns((n) => n + 1)}
        renderPage={(page) => <Page page={page} />}
      />

      <nav className="controls" aria-label="Pages">
        <button type="button" onClick={() => void book.current?.prev()}>
          ← Previous
        </button>
        <span className="where">Position {position}</span>
        <button type="button" onClick={() => void book.current?.next()}>
          Next →
        </button>
      </nav>
      <p className="jump">
        <button type="button" onClick={() => setPosition(SHEETS)}>
          Jump to the end
        </button>{" "}
        <button type="button" onClick={() => setPosition(-2)}>
          Close the book
        </button>
        <br />
        <small>{turns} turns so far</small>
      </p>
      <p className="sound">
        <label>
          <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />{" "}
          Sound
        </label>
        <label>
          Volume{" "}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
