/**
 * grabfold as a custom element, for any page and any framework.
 *
 * ```html
 * <script type="module" src="https://cdn.jsdelivr.net/npm/grabfold/dist/element.js"></script>
 *
 * <grab-fold covers="hard" label="Recipes" style="max-width: 800px">
 *   <div data-cover="front">…</div>
 *   <div>Page 1</div>
 *   <div>Page 2</div>
 *   <div>Page 3</div>
 *   <div data-cover="back">…</div>
 * </grab-fold>
 * ```
 *
 * Its children are the pages, in reading order, and each is moved into the
 * book as it is needed — the very element, never a copy, so whatever it holds
 * keeps working. Covers are marked with `data-cover`: `front` and `back` for
 * the outside of hard covers, `front-inside` and `back-inside` for the inner
 * faces. An odd page out at the end leaves the last page blank.
 *
 * Importing this file defines `<grab-fold>`. For another name, import
 * `GrabfoldElement` and define it yourself.
 */

import { Grabfold, type GrabfoldOptions } from "./book.ts";
import type { Covers, Layout, PageRef } from "./model.ts";
import type { Binding } from "./space.ts";

const Base: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

type CoverName = "front" | "front-inside" | "back-inside" | "back";

const NUMBERS = ["sheets", "page-ratio", "position", "duration", "thickness", "shadow", "gutter", "lift"] as const;
const FLAGS = ["no-gestures", "no-peek", "no-flick", "no-keyboard", "no-grab-block", "no-center"] as const;
const STRINGS = ["covers", "binding", "layout", "fit", "label", "spread-query"] as const;

export class GrabfoldElement extends Base {
  static get observedAttributes(): string[] {
    return [...NUMBERS, ...FLAGS, ...STRINGS];
  }

  /** The book itself, once the element is on the page. */
  book: Grabfold | null = null;

  private pages: HTMLElement[] = [];
  private covers = new Map<CoverName, HTMLElement>();
  /** Where pages wait while they are not in the book. */
  private stash: HTMLDivElement | null = null;
  private observer: MutationObserver | null = null;
  private extra: Partial<GrabfoldOptions> = {};

  connectedCallback(): void {
    if (this.book) return;
    if (!this.style.display) this.style.display = "block";
    this.stash = this.ownerDocument.createElement("div");
    this.stash.hidden = true;
    this.stash.className = "grabfold-stash";
    this.collect();
    this.append(this.stash);

    this.book = new Grabfold(this, {
      ...this.options(),
      render: (slot, page) => {
        const el = this.pageFor(page);
        if (!el) return;
        slot.append(el);
        return () => this.stash?.append(el);
      },
    });
    for (const type of ["turnstart", "turn", "change", "layout", "resize"] as const) {
      this.book.on(type, (detail) => {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
      });
    }

    // Pages added or taken away later are picked up.
    this.observer = new MutationObserver((records) => {
      const ours = (node: Node) => node === this.stash || node === this.book?.element;
      if (records.every((record) => [...record.addedNodes, ...record.removedNodes].every(ours))) return;
      this.collect();
      this.book?.setOptions(this.options());
      this.book?.refresh();
    });
    this.observer.observe(this, { childList: true });
  }

  disconnectedCallback(): void {
    // Moved elsewhere in the document, it is disconnected and connected again
    // straight away; only a real removal takes the book down.
    queueMicrotask(() => {
      if (this.isConnected || !this.book) return;
      this.observer?.disconnect();
      this.observer = null;
      const book = this.book;
      this.book = null;
      book.destroy();
      // The pages go back to being plain children.
      for (const el of [...this.covers.values(), ...this.pages]) this.append(el);
      this.stash?.remove();
      this.stash = null;
    });
  }

  attributeChangedCallback(): void {
    this.book?.setOptions(this.options());
  }

  /** Sets any option not covered by an attribute: a sound, `hard`, a fold renderer. */
  configure(options: Partial<Omit<GrabfoldOptions, "render">>): void {
    this.extra = { ...this.extra, ...options };
    this.book?.setOptions(this.options());
  }

  get position(): number {
    return this.book?.position ?? Number(this.getAttribute("position") ?? -2);
  }

  set position(value: number) {
    void this.book?.turnTo(value);
  }

  next(): Promise<boolean> {
    return this.book?.next() ?? Promise.resolve(false);
  }

  prev(): Promise<boolean> {
    return this.book?.prev() ?? Promise.resolve(false);
  }

  turnTo(position: number): Promise<boolean> {
    return this.book?.turnTo(position) ?? Promise.resolve(false);
  }

  jumpTo(position: number): void {
    this.book?.jumpTo(position);
  }

  /** Reads the children into pages and covers. */
  private collect(): void {
    const children = [...this.children].filter(
      (el): el is HTMLElement => el !== this.stash && !el.classList.contains("grabfold-frame"),
    );
    // Pages already in the book count too, wherever they are now.
    const known = [...this.covers.values(), ...this.pages].filter((el) => !children.includes(el) && this.contains(el));
    const all = [...known, ...children];
    this.covers.clear();
    this.pages = [];
    for (const el of all) {
      const cover = el.dataset.cover as CoverName | undefined;
      if (cover) this.covers.set(cover, el);
      else this.pages.push(el);
      if (el.parentElement === this) this.stash?.append(el);
    }
  }

  private pageFor(page: PageRef): HTMLElement | null {
    if (page.kind === "cover") {
      const name = (page.face === "outside" ? page.side : `${page.side}-inside`) as CoverName;
      return this.covers.get(name) ?? null;
    }
    const index = page.sheet * 2 + (page.kind === "back" ? 1 : 0);
    return this.pages[index] ?? null;
  }

  private options(): Omit<GrabfoldOptions, "render"> {
    const number = (name: string) => {
      const value = this.getAttribute(name);
      return value === null || value === "" ? undefined : Number(value);
    };
    const string = (name: string) => this.getAttribute(name) ?? undefined;
    const covers =
      (string("covers") as Covers | undefined) ??
      (this.covers.has("front") || this.covers.has("back")
        ? "hard"
        : this.covers.size > 0
          ? "inside"
          : "none");
    return {
      ...this.extra,
      sheets: number("sheets") ?? Math.ceil(this.pages.length / 2),
      covers,
      binding: string("binding") as Binding | undefined,
      layout: string("layout") as Layout | "auto" | undefined,
      spreadQuery: string("spread-query"),
      fit: string("fit") as "width" | "contain" | undefined,
      label: string("label"),
      pageRatio: number("page-ratio"),
      position: number("position"),
      duration: number("duration"),
      thickness: number("thickness"),
      shadow: number("shadow"),
      gutter: number("gutter"),
      lift: number("lift"),
      gestures: !this.hasAttribute("no-gestures"),
      peek: !this.hasAttribute("no-peek"),
      flick: !this.hasAttribute("no-flick"),
      keyboard: !this.hasAttribute("no-keyboard"),
      grabBlock: !this.hasAttribute("no-grab-block"),
      center: !this.hasAttribute("no-center"),
    };
  }
}

/** Defines the element under a name of your choosing. */
export function defineGrabfold(name = "grab-fold"): void {
  if (typeof customElements === "undefined" || customElements.get(name)) return;
  customElements.define(name, name === "grab-fold" ? GrabfoldElement : class extends GrabfoldElement {});
}

defineGrabfold();

declare global {
  interface HTMLElementTagNameMap {
    "grab-fold": GrabfoldElement;
  }
}
