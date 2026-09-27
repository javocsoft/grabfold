<script>
  import { mount, unmount } from "svelte";
  import { grabfold } from "grabfold/svelte";
  import { createPageTurnSound } from "grabfold/sound";
  import { defaultBoardTurnTakes, defaultPageTurnTakes } from "grabfold/sounds";
  import { SHEETS, describe } from "../shared/pages.js";
  import Page from "./Page.svelte";

  const sound = createPageTurnSound({ takes: defaultPageTurnTakes, boardTakes: defaultBoardTurnTakes });

  let where = $state("Front cover");
  let node = $state();

  const options = {
    sheets: SHEETS,
    covers: "hard",
    label: "A little book of colours",
    sound,
    // Each page is a component, mounted into its own element once.
    render(slot, page) {
      const component = mount(Page, { target: slot, props: { page } });
      return () => unmount(component);
    },
    onTurn: () => (where = describe(node.grabfold.view)),
  };
</script>

<div class="book" bind:this={node} use:grabfold={options}></div>

<nav class="controls">
  <button type="button" onclick={() => node.grabfold.prev()}>← Previous</button>
  <span class="where">{where}</span>
  <button type="button" onclick={() => node.grabfold.next()}>Next →</button>
</nav>
