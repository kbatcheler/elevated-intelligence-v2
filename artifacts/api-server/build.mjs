import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Externalize real third-party runtime dependencies so they load from
// node_modules at runtime. Workspace packages ship TypeScript source, so they
// are intentionally NOT externalized: esbuild compiles and inlines them.
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@workspace/"));

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/index.mjs",
  sourcemap: true,
  external,
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'module';",
      "import { fileURLToPath as __fileURLToPath } from 'url';",
      "import { dirname as __dirname_fn } from 'path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __dirname_fn(__filename);",
    ].join("\n"),
  },
});

console.log("api-server built to dist/index.mjs");
