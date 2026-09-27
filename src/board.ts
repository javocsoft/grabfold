import { gutterGradient, type Shading, type SheetFrame, type SheetRenderer } from "./sheet.ts";

/**
 * A rigid leaf mid-turn: a cover, or a page of a board book.
 *
 * Board does not fold. It swings round the spine in one piece, so this is a
 * 3D rotation rather than the fold's clip-and-reflect: the leaf turns about
 * the spine's edge under a perspective, its near side growing as it lifts
 * towards the reader, edge-on half way, and down flat on the facing page with
 * its other face up. Both faces are drawn and the browser hides whichever is
 * turned away.
 *
 * What makes it read as solid is the light: each face darkens as it turns
 * edge-on to the reader, and the board throws a shadow across the page it is
 * lifting off, deepest when it stands straight up.
 *
 * Where the leaf was taken hold of does not matter to a board — it cannot
 * crease — so the grab and the lift in each frame are ignored.
 */

function layer(doc: Document, className: string): HTMLDivElement {
  const el = doc.createElement("div");
  el.className = className;
  Object.assign(el.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%" });
  return el;
}

export class RigidSheet implements SheetRenderer {
  readonly root: HTMLDivElement;
  readonly restingSlot: HTMLDivElement;
  readonly turnedSlot: HTMLDivElement;

  private readonly cast: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private readonly frontShade: HTMLDivElement;
  private readonly backShade: HTMLDivElement;
  private readonly frontGutter: HTMLDivElement;
  private readonly backGutter: HTMLDivElement;
  private shading: Shading;
  private outside = { resting: false, turned: false };

  constructor(doc: Document, shading: Shading) {
    this.shading = shading;

    this.root = doc.createElement("div");
    this.root.className = "grabfold-sheet grabfold-board";
    this.root.setAttribute("aria-hidden", "true");
    Object.assign(this.root.style, {
      position: "absolute",
      top: "0",
      zIndex: "3",
      pointerEvents: "none",
      display: "none",
    });

    // The shadow the lifting board throws on the page beneath it. Flat on
    // the page, so not rotated with the board.
    this.cast = layer(doc, "grabfold-cast");
    this.cast.style.pointerEvents = "none";

    this.board = layer(doc, "grabfold-board-leaf");
    this.board.style.transformStyle = "preserve-3d";
    this.board.style.willChange = "transform";

    const face = (turned: boolean) => {
      const el = layer(doc, "grabfold-board-face");
      Object.assign(el.style, {
        background: "var(--grabfold-board, var(--grabfold-paper, #fbf8f1))",
        backfaceVisibility: "hidden",
        webkitBackfaceVisibility: "hidden",
        overflow: "hidden",
        // The far face is drawn already turned round, so it reads the right
        // way once the board has swung over.
        transform: turned ? "rotateY(180deg)" : "none",
      });
      const slot = layer(doc, "grabfold-slot");
      const gutter = layer(doc, "grabfold-gutter");
      gutter.style.pointerEvents = "none";
      const shade = layer(doc, "grabfold-shade");
      Object.assign(shade.style, { background: "#000", opacity: "0", pointerEvents: "none" });
      el.append(slot, gutter, shade);
      return { el, slot, gutter, shade };
    };
    const front = face(false);
    const back = face(true);
    this.restingSlot = front.slot;
    this.turnedSlot = back.slot;
    this.frontShade = front.shade;
    this.backShade = back.shade;
    this.frontGutter = front.gutter;
    this.backGutter = back.gutter;
    this.board.append(front.el, back.el);

    this.root.append(this.cast, this.board);
  }

  setShading(shading: Shading): void {
    this.shading = shading;
  }

  setOutside(resting: boolean, turned: boolean): void {
    this.outside = { resting, turned };
  }

  place(left: number, width: number, height: number): void {
    this.root.style.left = `${left}px`;
    this.root.style.width = `${width}px`;
    this.root.style.height = `${height}px`;
    // Scaled to the page, so a small book and a large one swing alike. Six
    // page widths away, a board standing straight up is drawn a fifth larger
    // at its free edge: the book seen from reading distance. At three it
    // grew by two fifths and looked like a book held against the nose.
    this.root.style.perspective = `${Math.round(width * 6)}px`;
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  draw(frame: SheetFrame): void {
    const { spine, width } = frame;
    const progress = Math.min(1, Math.max(0, frame.progress));
    const left = spine === "left";

    // Hinged on the spine, and turned towards the reader: away from the
    // spine's side, over, and down on the other.
    const angle = (left ? -180 : 180) * progress;
    this.root.style.perspectiveOrigin = left ? "0% 50%" : "100% 50%";
    this.board.style.transformOrigin = left ? "0% 50%" : "100% 50%";
    this.board.style.transform = `rotateY(${angle.toFixed(2)}deg)`;

    // Edge-on halfway: that is where each face is darkest, and the shadow on
    // the page below deepest.
    const standing = Math.sin(Math.PI * progress);
    const dark = this.shading.shadow * standing;
    this.frontShade.style.opacity = (dark * 0.9).toFixed(3);
    this.backShade.style.opacity = (dark * 0.9).toFixed(3);

    // The gutter each face carries is on the spine's side of it. The far face
    // lands on the facing page, whose spine is on the other side — the same
    // rule as a folding leaf. None on a cover's outside: a closed book has no
    // gutter.
    this.frontGutter.style.background = this.outside.resting
      ? "none"
      : gutterGradient(spine, this.shading.gutter);
    this.backGutter.style.background = this.outside.turned
      ? "none"
      : gutterGradient(left ? "right" : "left", this.shading.gutter);

    // Thrown across the page from the spine, as wide as the board stands tall.
    const reach = Math.max(1, width * 0.55 * standing);
    this.cast.style.background = `linear-gradient(${left ? "to right" : "to left"}, rgba(0,0,0,${(
      dark * 0.8
    ).toFixed(3)}), rgba(0,0,0,0) ${reach.toFixed(1)}px)`;
    // Only while the board is over its own page; once it is over the facing
    // one, the page it came off is out in the light.
    this.cast.style.opacity = progress < 0.5 ? "1" : "0";
  }
}
