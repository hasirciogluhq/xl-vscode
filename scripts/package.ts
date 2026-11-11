import { $ } from "bun";

await $`bun run scripts/build.ts`;
await $`bunx @vscode/vsce package --no-dependencies`;
