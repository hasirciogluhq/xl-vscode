# xl-vscode — notes for Claude

## What this repo is
- The VS Code extension for **xlang** (`.xl`, `*.test.xl`). It stands as the `xl-vscode/` git submodule of `hasirciogluhq/xlang` and references nothing of that repo's tree.
- Features: TextMate highlighting (`syntaxes/xlang.tmLanguage.json`), snippets, completion, hover, go-to-definition, formatter, compiler diagnostics (`xlang check <file> --diag-format json`) and run / build / test commands.
- No language server: sources are parsed locally in the extension. Stdlib modules for IntelliSense come from a `std/` directory (`xlang.stdPath`, or auto-detected).
- Needs the `xlang` compiler binary only for diagnostics and commands (`xlang.compilerPath`).

## Layout
- `src/extension.ts` activation and commands; `diagnostics.ts` compiler runner; `completions.ts`, `hover.ts`, `symbols.ts`, `languageIndex.ts` the local parser and index; `formatter.ts`; `builtins.ts` keyword/builtin docs; `paths.ts` compiler/std discovery.
- `scripts/build.ts` bundles to `out/`; `scripts/package.ts` builds the `.vsix`.
- `package.json` holds the manifest: settings (`xlang.*`), commands, menus.

## Tooling
- **Bun** + TypeScript. `bun install`, `bun run compile`, `bun run package`. `out/`, `node_modules/` and `*.vsix` are not committed.

## Rules
- Repo content is English (code, comments, docs, commits). User chat is Turkish.
- Keep the extension in step with the language: a new keyword, builtin, attribute, diagnostic code or CLI flag in xlang means updating the grammar, `builtins.ts`, snippets and README here.
- Docs of the language live in `xlang-docs/` of the main repo; this repo only has its own `README.md`.
- File edits use the built-in Read/Edit/Write tools.
- **Never add `Co-Authored-By` trailers, "Authored by Claude" or any "Generated with Claude Code" line** to commits, PRs or files in this repo.
- Commits here are pushed first; the main repo then commits the updated submodule pointer.
