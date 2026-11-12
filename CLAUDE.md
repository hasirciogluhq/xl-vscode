# xl-vscode — notes for Claude

## What this repo is
- The VS Code extension for **xlang** (`.xl`, `*.test.xl`). It stands as the `xl-vscode/` git submodule of `hasirciogluhq/xlang` and references nothing of that repo's tree.
- Features: TextMate highlighting (`syntaxes/xlang.tmLanguage.json`), snippets, completion, hover, go-to-definition, formatter, `xlc` diagnostics, run / build / test / layout / IR commands and package commands.
- No language server: sources are parsed locally in the extension (`parser.ts`). The compiler is the authority; the parser only feeds IntelliSense.

## The compiler contract (read before touching `compiler.ts`, `diagnostics.ts`, `paths.ts`)
- The compiler is **`xlc`** (`xlc/` submodule of the main repo). It is one command: `xlc [options] main.xl [objects...] [-o out] [--emit=exe|obj|ir|bc|header|static|shared]`. It has no `check`/`run`/`test`/`package` subcommands, no embedded stdlib and no package manager.
- Type-check is `--check`; diagnostics for the editor are `--diag-format json --context 0` (one JSON object per line on stderr: `code`, `severity` error|warning, `suppressed`, `message`, `labels[]`, `notes[]`, `detail`, `reason`, `fix`).
- Libraries are connected with `-M NAME=DIR` (`import "NAME"` and `"NAME/sub"` resolve inside DIR) and `--import SPEC`. The stdlib is `-M std=<xl-std dir> --import std`; features are plain definitions (`-DfeatureDefaultAllocator=true`). A package is `-M github.com/user/repo=<project>/.xlang/cache/<repo>@<tag>`.
- The `xl` tool (outside this repo) reads `toolchain.toml`/`xlang.toml`/`xlang.lock`/`xlang.local.toml` and builds those flags; `xl env --json <file>` prints them. `environment.ts` asks it first; `project.ts` is the same computation as a fallback. Keep both in step with `xlang-docs` (compiler/cli.md, packages page). `run` and `test` are orchestrated by `runner.ts` (build to a temp executable, run it).
- Source of truth for the language: the `xlc` sources (`xlc/src/lang/lexer`, `xlc/src/util/diagnostics.cpp` for the code table, `xlc/src/cli/main.cpp` for flags) and `xlang-docs/`. Primitive types are `i8..i64` and `u8..u64`; `str`, slices `[]T`/`[]mut T`, tuples, `const`, `try/catch`, `delete`, payload enums are language features.

## Layout
- `src/extension.ts` activation, commands, watchers, status bar, quick fixes; `compiler.ts` xlc discovery and flag building; `runner.ts` run/test terminal; `diagnostics.ts` compiler runner and JSON mapping.
- `project.ts` (manifest, lock, cache) and `toml.ts` and `parser.ts` have **no `vscode` import** so `bun test` covers them. Keep it that way.
- `paths.ts` std root, module roots, import resolution; `languageIndex.ts` imports/members/scopes; `symbols.ts` presentation; `completions.ts`, `hover.ts`, `formatter.ts`; `builtins.ts` keyword/type/builtin/attribute/role catalog; `diagnosticCodes.ts` code titles.
- `scripts/build.ts` bundles to `out/`; `scripts/package.ts` builds the `.vsix`. `package.json` holds the manifest: settings (`xlang.*`), commands, menus.

## Tooling
- **Bun** + TypeScript. `bun install`, `bun run compile`, `bun run typecheck`, `bun test`, `bun run package`. `out/`, `node_modules/` and `*.vsix` are not committed.
- Before a commit: `bun run typecheck && bun test && bun run compile`.

## Versioning and releases
- The extension follows [Semantic Versioning](https://semver.org). `version` in `package.json` is the single source of truth; a release tag is `vX.Y.Z` (or `vX.Y.Z-rc.N` for a pre-release) and must equal it.
  - **Major**: a breaking change to settings keys, command IDs or the minimum supported `xlc` or VS Code version.
  - **Minor**: a new feature, setting, command or language construct.
  - **Patch**: a bug fix or an internal change with no user-visible effect.
- A release is one commit that only bumps `version`, adds the `CHANGELOG.md` entry (Keep a Changelog format: Added / Changed / Fixed / Removed) and updates `engines.vscode` if needed. Feature commits never bump the version.
- Releases are cut by maintainers from `main`: run `bun run typecheck && bun test && bun run package`, install the `.vsix` into a clean VS Code, then tag and publish (`vsce publish`, and `ovsx publish` for Open VSX) from the tagged commit. A tag never moves and a published version is never overwritten.
- Local testing never needs a version change: use F5 (Extension Development Host) or install the `.vsix` produced by `bun run package`. Do not commit `.vsix` files.
- Pre-release builds use an odd/even convention or `-rc.N` tags and are published with `vsce publish --pre-release`.
- When asked to release, Claude prepares the release commit and the changelog entry and stops before tagging or publishing; tagging and publishing are the maintainer's step.

## Rules
- Repo content is English (code, comments, docs, commits). User chat is Turkish.
- Keep the extension in step with the language: a new keyword, builtin, attribute, role, diagnostic code or compiler flag means updating the grammar, `builtins.ts`, `diagnosticCodes.ts`, snippets and README here.
- Docs of the language live in `xlang-docs/`; the extension's behavior is documented only in this repo's `README.md`, which must match `package.json` (commands, settings) in the same change.
- File edits use the built-in Read/Edit/Write tools.
- **Never add `Co-Authored-By` trailers, "Authored by Claude" or any "Generated with Claude Code" line** to commits, PRs or files in this repo.
- Commits here are pushed first; the main repo then commits the updated submodule pointer.
