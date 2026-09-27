/**
 * grabfold for Vue 3.
 *
 * ```vue
 * <GrabfoldBook :sheets="12" covers="hard" v-model:position="at">
 *   <template #page="{ page }">
 *     <MyPage :page="page" />
 *   </template>
 * </GrabfoldBook>
 * ```
 *
 * The book is the framework-free core; each page is the `page` slot,
 * teleported into the element the core hands over for it. So a page is plain
 * Vue — reactive state, components, event handlers — and is never copied: it
 * is moved as the leaf turns and keeps its state.
 */

import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  Teleport,
  triggerRef,
  watch,
  type PropType,
  type SlotsType,
} from "vue";
import { Grabfold, type ChangeEvent, type GrabfoldOptions, type TurnEvent } from "./book.ts";
import type { Covers, Layout, PageRef } from "./model.ts";
import type { Binding } from "./space.ts";

type Options = Omit<GrabfoldOptions, "render" | "position" | "onTurn" | "onTurnStart" | "onLayoutChange">;

/** The options that are plain values, and so are watched and passed on as they change. */
const PLAIN = [
  "sheets",
  "covers",
  "binding",
  "layout",
  "spreadQuery",
  "pageRatio",
  "fit",
  "duration",
  "commitAt",
  "dragThreshold",
  "gestures",
  "flick",
  "peek",
  "thickness",
  "grabBlock",
  "center",
  "reducedMotion",
  "keyboard",
  "label",
  "shadow",
  "gutter",
  "lift",
] as const;

export const GrabfoldBook = defineComponent({
  name: "GrabfoldBook",
  props: {
    sheets: { type: Number, required: true },
    covers: String as PropType<Covers>,
    hard: Function as PropType<(sheet: number) => boolean>,
    binding: String as PropType<Binding>,
    layout: String as PropType<Layout | "auto">,
    spreadQuery: String,
    pageRatio: Number,
    fit: String as PropType<"width" | "contain">,
    /** Where the book is open. With `v-model:position`, turned to, animated, when it changes. */
    position: Number,
    duration: Number,
    commitAt: Number,
    dragThreshold: Number,
    gestures: { type: Boolean, default: undefined },
    flick: { type: Boolean, default: undefined },
    peek: { type: Boolean, default: undefined },
    thickness: Number,
    grabBlock: { type: Boolean, default: undefined },
    center: { type: Boolean, default: undefined },
    reducedMotion: { type: [String, Boolean] as PropType<"auto" | boolean>, default: undefined },
    keyboard: { type: Boolean, default: undefined },
    label: String,
    shadow: Number,
    gutter: Number,
    lift: Number,
    sound: Object as PropType<GrabfoldOptions["sound"]>,
    foldRenderer: Function as PropType<GrabfoldOptions["foldRenderer"]>,
  },
  emits: {
    turnstart: (_event: TurnEvent) => true,
    turn: (_event: TurnEvent) => true,
    change: (_event: ChangeEvent) => true,
    layout: (_layout: Layout) => true,
    "update:position": (_position: number) => true,
  },
  slots: Object as SlotsType<{ page: { page: PageRef } }>,
  setup(props, { emit, slots, expose }) {
    const host = shallowRef<HTMLDivElement | null>(null);
    const book = shallowRef<Grabfold | null>(null);
    const pages = shallowRef(new Map<HTMLElement, PageRef>());
    let pending: number | null = null;

    const plain = (): Partial<Options> =>
      Object.fromEntries(PLAIN.map((key) => [key, props[key]]).filter(([, value]) => value !== undefined));

    onMounted(() => {
      const instance = new Grabfold(host.value!, {
        ...(plain() as Options),
        sheets: props.sheets,
        position: props.position,
        render(slot, page) {
          pages.value.set(slot, page);
          triggerRef(pages);
          return () => {
            pages.value.delete(slot);
            triggerRef(pages);
          };
        },
        // Read when they are needed, so they can be changed at any time.
        hard: (sheet) => props.hard?.(sheet) ?? false,
        sound: { play: (event) => props.sound?.play(event) },
        foldRenderer: props.foldRenderer ?? null,
      });
      instance.on("turnstart", (event) => emit("turnstart", event));
      instance.on("turn", (event) => {
        emit("turn", event);
        const wanted = pending;
        pending = null;
        if (wanted !== null && wanted !== instance.position) queueMicrotask(() => void instance.turnTo(wanted));
      });
      instance.on("change", (event) => {
        emit("change", event);
        emit("update:position", event.position);
      });
      instance.on("layout", (layout) => emit("layout", layout));
      book.value = instance;
    });

    onBeforeUnmount(() => {
      book.value?.destroy();
      book.value = null;
    });

    watch(
      () => JSON.stringify(plain()),
      () => book.value?.setOptions(plain()),
    );

    watch(
      () => props.position,
      (wanted) => {
        const instance = book.value;
        if (wanted === undefined || !instance || instance.position === wanted) return;
        if (instance.isTurning) pending = wanted;
        else void instance.turnTo(wanted);
      },
    );

    expose({
      next: () => book.value?.next() ?? Promise.resolve(false),
      prev: () => book.value?.prev() ?? Promise.resolve(false),
      turnTo: (position: number) => book.value?.turnTo(position) ?? Promise.resolve(false),
      jumpTo: (position: number) => book.value?.jumpTo(position),
      canNext: () => book.value?.canNext() ?? false,
      canPrev: () => book.value?.canPrev() ?? false,
      book,
    });

    // Vue's own scheduler flushes in a microtask, which always comes before
    // the next frame is painted: a page asked for mid-turn is there in time.
    return () =>
      h("div", { ref: host }, [...pages.value].map(([slot, page]) => h(Teleport, { to: slot }, slots.page?.({ page }))));
  },
});

export type { PageRef, TurnEvent, ChangeEvent, Layout };
