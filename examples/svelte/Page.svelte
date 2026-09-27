<script>
  import { pageHTML } from "../shared/pages.js";

  let { page } = $props();
  // Kept through a turn: the component is moved, never mounted twice.
  let likes = $state(0);
</script>

<div class="holder">
  {@html pageHTML(page)}
  {#if page.kind === "front"}
    <button type="button" class="like" onclick={() => (likes += 1)}>♥ {likes}</button>
  {/if}
</div>

<style>
  .holder { position: absolute; inset: 0; }
  .holder :global(.page) { height: 100%; }
  .like {
    position: absolute; top: 12px; right: 12px; font: inherit; cursor: pointer;
    border: 1px solid #d6cfbd; background: #fffdf8; border-radius: 999px; padding: 2px 10px;
  }
</style>
