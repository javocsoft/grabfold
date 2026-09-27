// Assembles the demo site in _site/: the configurator from site/, the
// library's build in dist/, and every example. GitHub Pages publishes it.
//
//   npm run site            build it
//   node scripts/serve.mjs 5173 _site   look at it
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "_site");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, "site"), out, { recursive: true });
await cp(resolve(root, "dist"), resolve(out, "dist"), { recursive: true });
await cp(resolve(root, "examples"), resolve(out, "examples"), {
  recursive: true,
  // Sources only the bundles need are left behind.
  filter: (source) => !/\.(tsx?|svelte|d\.ts)$/.test(source) || source.endsWith("pages.d.ts"),
});
console.log(`site ready in ${out}`);
