# xl-vscode — notes for Claude

## What this repo is
- The VS Code extension for **xlang** (`.xl`, `*.test.xl`). It stands as the `xl-vscode/` git submodule of `hasirciogluhq/xlang` and references nothing of that repo's tree.
- Features: TextMate highlighting (`syntaxes/xlang.tmLanguage.json`), snippets, completion, hover, go-to-definition, formatter, `xlc` diagnostics, run / build / test / layout / IR commands and package commands.
- No language server: sources are parsed locally in the extension (`parser.ts`). The compiler is the authority; the parser only feeds IntelliSense.

## The compiler contract (read before touching `compiler.ts`, `diagnostics.ts`, `paths.ts`)
- The compiler is **`xlc`** (`xlc/` submodule of the main repo). It is one command: `xlc [options] main.xl [objects...] [-o out] [--emit=exe|obj|ir|bc|header|static|shared]`. It has no `check`/`run`/`test`/`package` subcommands, no embedded stdlib and no package manager.
- Type-check is `--check`; diagnostics for the editor are `--diag-format json --context 0` (one JSON object per line on stderr: `code`, `severity` error|warning, `suppressed`, `message`, `labels[]`, `notes[]`, `detail`, `reason`, `fix`).
- Libraries are connected with `-M NAME=DIR` (`import "NAME"` and `"NAME/sub"` resolve inside DIR) and `--import SPEC`. The stdlib is `-M std=<xl-std dir> --import std`; features are plain definitions (`-DfeatureDefaultAllocator=true`). A package is `-M github.com/user/repo=<project>/.xlang/cache/<repo>@<tag>`.
- The `xlang` tool (outside this repo) reads `xlang.toml`/`xlang.lock`/`.xlang/cache` and builds those flags. `project.ts` + `paths.ts` do the same reading for the editor; keep them in step with `xlang-docs` (packages page). `run` and `test` are orchestrated by `runner.ts` (build to a temp executable, run it).
- Source of truth for the language: the `xlc` sources (`xlc/src/lang/lexer`, `xlc/src/util/diagnostics.cpp` for the code table, `xlc/src/cli/main.cpp` for flags) and `xlang-docs/`. Primitive types are `i8..i64` and `u8..u64`; `str`, slices `[]T`/`[]mut T`, tuples, `const`, `try/catch`, `delete`, payload enums are language features.

## Layout
- `src/extension.ts` activation, commands, watchers, status bar, quick fixes; `compiler.ts` xlc discovery and flag building; `runner.ts` run/test terminal; `diagnostics.ts` compiler runner and JSON mapping.
- `project.ts` (manifest, lock, cache) and `toml.ts` and `parser.ts` have **no `vscode` import** so `bun test` covers them. Keep it that way.
- `paths.ts` std root, module roots, import resolution; `languageIndex.ts` imports/members/scopes; `symbols.ts` presentation; `completions.ts`, `hover.ts`, `formatter.ts`; `builtins.ts` keyword/type/builtin/attribute/role catalog; `diagnosticCodes.ts` code titles.
- `scripts/build.ts` bundles to `out/`; `scripts/package.ts` builds the `.vsix`. `package.json` holds the manifest: settings (`xlang.*`), commands, menus.

## Tooling
- **Bun** + TypeScript. `bun install`, `bun run compile`, `bun run typecheck`, `bun test`, `bun run package`. `out/`, `node_modules/` and `*.vsix` are not committed.
- Before a commit: `bun run typecheck && bun test && bun run compile`.

## Rules
- Repo content is English (code, comments, docs, commits). User chat is Turkish.
- Keep the extension in step with the language: a new keyword, builtin, attribute, role, diagnostic code or compiler flag means updating the grammar, `builtins.ts`, `diagnosticCodes.ts`, snippets and README here.
- Docs of the language live in `xlang-docs/` of the main repo; this repo only has its own `README.md`.
- Do not bump the version in `package.json` unless the user asks.
- File edits use the built-in Read/Edit/Write tools.
- **Never add `Co-Authored-By` trailers, "Authored by Claude" or any "Generated with Claude Code" line** to commits, PRs or files in this repo.
- Commits here are pushed first; the main repo then commits the updated submodule pointer.
