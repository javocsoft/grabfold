// grabfold in Vue 3, written with render functions so it needs no compiler.
// In a project of your own the same component reads naturally as a template:
//
//   <GrabfoldBook :sheets="SHEETS" covers="hard" v-model:position="position">
//     <template #page="{ page }"><Page :page="page" /></template>
//   </GrabfoldBook>
import { createApp, defineComponent, h, ref } from "vue";
import { GrabfoldBook } from "grabfold/vue";
import { createPageTurnSound } from "grabfold/sound";
import { defaultBoardTurnTakes, defaultPageTurnTakes } from "grabfold/sounds";
import type { ChangeEvent, PageRef } from "grabfold";
import { SHEETS, describe, pageHTML } from "../shared/pages.js";

const sound = createPageTurnSound({ takes: defaultPageTurnTakes, boardTakes: defaultBoardTurnTakes });

/** A page, with a little state of its own to show it survives a turn. */
const Page = defineComponent({
  props: { page: { type: Object as () => PageRef, required: true } },
  setup(props) {
    const likes = ref(0);
    return () =>
      h("div", { style: "position:absolute;inset:0" }, [
        h("div", { innerHTML: pageHTML(props.page), style: "height:100%" }),
        props.page.kind === "front"
          ? h(
              "button",
              {
                class: "like",
                onClick: () => (likes.value += 1),
                style:
                  "position:absolute;top:12px;right:12px;font:inherit;border:1px solid #d6cfbd;background:#fffdf8;border-radius:999px;padding:2px 10px;cursor:pointer",
              },
              `♥ ${likes.value}`,
            )
          : null,
      ]);
  },
});

const App = defineComponent({
  setup() {
    const position = ref(-2);
    const book = ref<InstanceType<typeof GrabfoldBook> | null>(null);
    const where = ref("");
    return () => [
      h(
        GrabfoldBook,
        {
          class: "book",
          ref: book,
          sheets: SHEETS,
          covers: "hard",
          label: "A little book of colours",
          sound,
          position: position.value,
          "onUpdate:position": (value: number) => (position.value = value),
          onChange: (event: ChangeEvent) => (where.value = describe(event.view)),
        },
        { page: ({ page }: { page: PageRef }) => h(Page, { page }) },
      ),
      h("nav", { class: "controls" }, [
        h("button", { type: "button", onClick: () => (position.value = Math.max(-2, position.value - 1)) }, "← Previous"),
        h("span", { class: "where" }, where.value || "Front cover"),
        h("button", { type: "button", onClick: () => (position.value = Math.min(SHEETS, position.value + 1)) }, "Next →"),
      ]),
    ];
  },
});

createApp(App).mount("#app");
