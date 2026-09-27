// Bundles the examples that need a build step: React, Vue, Svelte and the
// PDF reader. Each lands in its own examples/<name>/dist/.
//
// `grabfold` and its subpaths resolve to this repository's own build, so the
// examples exercise exactly what would be published. Run `npm run build`
// first (`npm run demo` does both).
import { build } from "esbuild";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";

const root = resolve(import.meta.dirname, "..");
const at = (...parts) => resolve(root, ...parts);

/** Compiles .svelte files as esbuild meets them. */
const svelte = {
  name: "svelte",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      const { js } = compile(source, { filename: path, generate: "client", css: "injected" });
      return { contents: js.code, loader: "js", resolveDir: resolve(path, "..") };
    });
  },
};

const common = {
  bundle: true,
  format: "esm",
  sourcemap: true,
  minify: false,
  logLevel: "info",
  alias: { grabfold: at("dist") },
  define: {
    "process.env.NODE_ENV": '"development"',
    __VUE_OPTIONS_API__: "false",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  conditions: ["svelte", "browser"],
};

await Promise.all([
  build({ ...common, entryPoints: [at("examples/react/main.tsx")], outfile: at("examples/react/dist/main.js"), jsx: "automatic" }),
  build({ ...common, entryPoints: [at("examples/vue/main.ts")], outfile: at("examples/vue/dist/main.js") }),
  build({ ...common, entryPoints: [at("examples/svelte/main.ts")], outfile: at("examples/svelte/dist/main.js"), plugins: [svelte] }),
  build({ ...common, entryPoints: [at("examples/pdf/main.js")], outfile: at("examples/pdf/dist/main.js") }),
]);

// pdf.js does its parsing in a worker, loaded from its own file.
await mkdir(at("examples/pdf/dist"), { recursive: true });
await copyFile(
  at("node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  at("examples/pdf/dist/pdf.worker.min.mjs"),
);
