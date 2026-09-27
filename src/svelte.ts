/**
 * grabfold for Svelte, as an action. It needs nothing from Svelte itself.
 *
 * ```svelte
 * <script>
 *   import { mount, unmount } from "svelte";
 *   import { grabfold } from "grabfold/svelte";
 *   import Page from "./Page.svelte";
 *
 *   let position = $state(-1);
 * </script>
 *
 * <div use:grabfold={{
 *   sheets: 12,
 *   render(slot, page) {
 *     const component = mount(Page, { target: slot, props: { page } });
 *     return () => unmount(component);
 *   },
 *   onTurn: (event) => (position = event.to),
 * }}></div>
 * ```
 *
 * A page is mounted once into its own element, and that element is moved as
 * the leaf turns, so a Svelte component on a page keeps its state. Changing
 * the options passes them on to the book; `render` is read afresh each time.
 */

import { Grabfold, type GrabfoldOptions } from "./book.ts";

export interface GrabfoldAction {
  update(options: GrabfoldOptions): void;
  destroy(): void;
}

export function grabfold(node: HTMLElement, options: GrabfoldOptions): GrabfoldAction {
  let current = options;
  const book = new Grabfold(node, {
    ...options,
    render: (slot, page) => current.render(slot, page),
  });
  // Available to the component through the element: `node.grabfold.next()`.
  (node as HTMLElement & { grabfold?: Grabfold }).grabfold = book;
  return {
    update(next) {
      const renderChanged = next.render !== current.render;
      current = next;
      const { render: _render, ...rest } = next;
      book.setOptions(rest);
      if (renderChanged) book.refresh();
    },
    destroy() {
      book.destroy();
      delete (node as HTMLElement & { grabfold?: Grabfold }).grabfold;
    },
  };
}

export { Grabfold };
export type { GrabfoldOptions };
