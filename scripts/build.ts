import { rmSync, mkdirSync } from "node:fs";

rmSync("./out", { recursive: true, force: true });
mkdirSync("./out", { recursive: true });

const result = await Bun.build({
  entrypoints: ["./src/extension.ts"],
  outdir: "./out",
  target: "node",
  format: "cjs",
  external: ["vscode"],
  sourcemap: "linked",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("Built extension -> out/extension.js");
