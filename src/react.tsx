"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Grabfold, type GrabfoldOptions, type TurnEvent } from "./book.ts";
import type { Layout, PageRef } from "./model.ts";

/**
 * grabfold for React.
 *
 * The book itself is the framework-free core; this only paints its pages.
 * The core hands over an empty element for each side it needs and React
 * renders `renderPage` into it through a portal, so a page is ordinary React
 * — state, effects, event handlers and all — and is never cloned.
 */

export interface GrabfoldBookHandle {
  next(): Promise<boolean>;
  prev(): Promise<boolean>;
  turnTo(position: number): Promise<boolean>;
  jumpTo(position: number): void;
  canNext(): boolean;
  canPrev(): boolean;
  readonly position: number;
  readonly layout: Layout;
  /** The core instance, for anything not wrapped here. */
  readonly book: Grabfold | null;
}

export interface GrabfoldBookProps extends Omit<GrabfoldOptions, "render" | "position"> {
  /** The content of one page. It is placed in a box the size of the page. */
  renderPage: (page: PageRef) => ReactNode;
  /** Controlled position. Changing it turns the book to it, animated. */
  position?: number;
  /** Where to open when uncontrolled. */
  defaultPosition?: number;
  /** Called when a turn lands, with the new position. */
  onPositionChange?: (position: number) => void;
  className?: string;
  style?: CSSProperties;
}

const keys = new WeakMap<HTMLElement, string>();
let counter = 0;
function keyOf(slot: HTMLElement): string {
  let key = keys.get(slot);
  if (!key) {
    key = `grabfold-${++counter}`;
    keys.set(slot, key);
  }
  return key;
}

/** Only the plain values: callbacks and the renderer are read live. */
function plainOptions(props: GrabfoldBookProps) {
  const {
    renderPage: _renderPage,
    position: _position,
    defaultPosition: _defaultPosition,
    onPositionChange: _onPositionChange,
    onTurn: _onTurn,
    onTurnStart: _onTurnStart,
    onLayoutChange: _onLayoutChange,
    sound: _sound,
    hard: _hard,
    foldRenderer: _foldRenderer,
    className: _className,
    style: _style,
    ...rest
  } = props;
  return rest;
}

export const GrabfoldBook = forwardRef<GrabfoldBookHandle, GrabfoldBookProps>(
  function GrabfoldBook(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const book = useRef<Grabfold | null>(null);
    const latest = useRef(props);
    /**
     * A controlled position that changed while a turn was running, to turn to
     * once it lands. Recorded when it happens, never guessed afterwards from
     * the props: at the moment a turn lands React has not re-rendered yet, and
     * the props still say where the book *was*.
     */
    const pending = useRef<number | null>(null);
    const [slots, setSlots] = useState<ReadonlyMap<HTMLElement, PageRef>>(() => new Map());

    const options = plainOptions(props);
    const optionsKey = JSON.stringify(options);
    const firstKey = useRef(optionsKey);

    useLayoutEffect(() => {
      latest.current = props;
    });

    useLayoutEffect(() => {
      const element = host.current;
      if (!element) return;

      // Once the book is live, a page is painted synchronously: at the end of
      // a turn the sheet is taken away and the page it became is shown in the
      // same frame, and a page that arrived a tick late would blink. React
      // does not allow that from inside its own effects, which is the only
      // time `live` is false.
      let live = false;
      const update = (change: (map: ReadonlyMap<HTMLElement, PageRef>) => ReadonlyMap<HTMLElement, PageRef>) => {
        if (live) flushSync(() => setSlots(change));
        else setSlots(change);
      };

      const instance = new Grabfold(element, {
        ...plainOptions(latest.current),
        position: latest.current.position ?? latest.current.defaultPosition,
        render(slot, page) {
          update((map) => new Map(map).set(slot, page));
          return () =>
            update((map) => {
              const next = new Map(map);
              next.delete(slot);
              return next;
            });
        },
        onTurnStart: (event: TurnEvent) => latest.current.onTurnStart?.(event),
        onTurn: (event: TurnEvent) => {
          latest.current.onTurn?.(event);
          latest.current.onPositionChange?.(event.to);
          const wanted = pending.current;
          pending.current = null;
          if (wanted !== null && wanted !== instance.position) {
            queueMicrotask(() => void instance.turnTo(wanted));
          }
        },
        onLayoutChange: (layout: Layout) => latest.current.onLayoutChange?.(layout),
        // Read live, so a sound created in render or swapped later is the one heard.
        sound: { play: (event: TurnEvent) => latest.current.sound?.play(event) },
        // Likewise which sheets are rigid, which is a function and so cannot
        // go through the options compared by value.
        hard: (sheet: number) => latest.current.hard?.(sheet) ?? false,
        // Made once, when the book is: a renderer holds a GPU context.
        foldRenderer: latest.current.foldRenderer,
      });
      book.current = instance;
      live = true;

      return () => {
        live = false;
        instance.destroy();
        book.current = null;
      };
    }, []);

    // Options changed after mount. Deferred out of the effect so the pages the
    // change asks for can be painted synchronously, like every other.
    useEffect(() => {
      if (optionsKey === firstKey.current) return;
      firstKey.current = "";
      const next = JSON.parse(optionsKey) as Partial<GrabfoldOptions>;
      queueMicrotask(() => book.current?.setOptions(next));
    }, [optionsKey]);

    // A controlled position: turn to it, animated, when it changes. If a turn
    // is already running, it is turned to once that one lands.
    useEffect(() => {
      const wanted = props.position;
      if (wanted === undefined) return;
      queueMicrotask(() => {
        const instance = book.current;
        if (!instance || instance.position === wanted) return;
        if (instance.isTurning) pending.current = wanted;
        else void instance.turnTo(wanted);
      });
    }, [props.position]);

    useImperativeHandle(
      ref,
      () => ({
        next: () => book.current?.next() ?? Promise.resolve(false),
        prev: () => book.current?.prev() ?? Promise.resolve(false),
        turnTo: (position: number) => book.current?.turnTo(position) ?? Promise.resolve(false),
        jumpTo: (position: number) => book.current?.jumpTo(position),
        canNext: () => book.current?.canNext() ?? false,
        canPrev: () => book.current?.canPrev() ?? false,
        get position() {
          return book.current?.position ?? -1;
        },
        get layout() {
          return book.current?.layout ?? "spread";
        },
        get book() {
          return book.current;
        },
      }),
      [],
    );

    return (
      <div ref={host} className={props.className} style={props.style}>
        {[...slots].map(([slot, page]) => createPortal(props.renderPage(page), slot, keyOf(slot)))}
      </div>
    );
  },
);

export type { PageRef, Layout, TurnEvent };
