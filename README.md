# xlang — VS Code Extension

Language support for **xlang** (`.xl`, `*.test.xl`): syntax highlighting, IntelliSense with package-aware
module resolution, hover docs, go-to-definition, `xlc` diagnostics, formatting, snippets and
run / build / test / package commands.

Built with **Bun** + TypeScript. It works best with the [`xl`](https://github.com/hasirciogluhq/xlang) tool
installed: `xl lc install` puts the [`xlc`](https://github.com/hasirciogluhq/xlc) compiler and the
[`xl-std`](https://github.com/hasirciogluhq/xl-std) standard library under `~/.xlang`, `xl pkg ...` manages
packages, and `xl env --json <file>` tells the extension which compiler, stdlib, package roots and flags a file
builds with.

## How it talks to the compiler

`xlc` is one command that only compiles. It has no standard library of its own, no package manager and no
`check` or `run` subcommands. Everything above it is done here, with the arguments `xl env` reports:

```
xlc main.xl --check \
    -M github.com/user/repo=<project>/.xlang/cache/github.com/user/repo@v1.2.0 \
    -M std=<xl-std> --import std -DfeatureDefaultAllocator=true \
    --diag-format json --context 0
```

| Task | What the extension runs |
|------|-------------------------|
| Diagnostics, *Check Current File* | `xlc <file> --check <module flags> --diag-format json` |
| *Build Current File* | `xlc <file> -o <file without extension> <module flags>` |
| *Run Current File* | builds to a temporary executable, then runs it in a terminal |
| *Test Current File* / *Run Test Suite* | builds and runs every `*.test.xl`; a non-zero status fails the file |
| *Show Type Layouts / LLVM IR / HIR* | `--dump-layout`, `--emit=ir -o -`, `--dump-hir`, shown in a new editor |
| *Explain Diagnostic Code* | `xlc --explain <CODE>` |

`<module flags>` are `-M std=<dir> --import std -DfeatureDefaultAllocator=true`, the `-M NAME=DIR` package
roots, the `[build] flags` of `xlang.local.toml`, then the `-D` flags from the settings, `--target`, `--safety`,
`-O` and `xlang.extraArgs`. A file that sits inside a root is part of that root, so that root is left out for it.
**xlang: Show Compiler, Std and Module Roots** prints exactly what is in use for the active file and where it
came from (`xl env` or the extension's own reading).

## Module resolution

The extension runs `xl env --json <file>` (setting `xlang.useXlEnv`, on by default) and caches the answer per
project until one of the files below changes. Without `xl` it computes the same result itself. Each layer
replaces what it names, lowest first:

1. **The active toolchain**: `$XLANG_HOME/toolchain.toml` (`~/.xlang` by default), written by `xl lc install`,
   `xl lc update` and `xl lc use`. It names the compiler `$XLANG_HOME/xlc/<tag>/xlc` and the stdlib
   `$XLANG_HOME/std/<tag>`.
2. **`xlang.toml`**, the nearest one above the file: every `path` dependency maps to its directory, and every
   `xlang.lock` entry to `<project>/.xlang/cache/<repository>@<tag>/`. A package that is not on disk is reported.
3. **`xlang.local.toml`** next to it, a per-checkout file that is not committed:

   ```toml
   [toolchain]
   xlc = "../xlc/build/macosx/arm64/release/xlc"   # a compiler build
   std = "../xl-std"                               # a stdlib checkout

   [modules]
   "github.com/user/repo" = "../repo"              # work on a package next to the project

   [build]
   flags = ["-DdebugLog=true"]
   ```
4. **`$XLC` and `$XLANG_STD`**.
5. **The `xlang.stdPath` setting** (passed to `xl env` as `--std`) and `xlang.compilerPath`.

`import "github.com/user/repo"` and `import "github.com/user/repo/sub"` resolve inside the package (`index.xl`,
`sub.xl` or `sub/index.xl`); other paths are searched from the importing file's directory, then the project
directory. Changes to `xlang.toml`, `xlang.lock`, `xlang.local.toml`, `.xlang/cache` and `toolchain.toml` are
picked up at once.

An import of a package that is not installed gets a quick fix: *Install package host/user/repo*.

## Features

### Highlighting

Keywords and control flow (`while`, `do`, `for`, `in`, `break`, `continue`, labels, `switch`, `defer`, `try`,
``catch`, `unsafe`), declarations (`fn`, `struct`, `class`, `interface`, `impl` for an interface and inherent
`impl<T> Type<T>`, `enum`, `type`, `define`, `const`, `global`, `register`, `new`, `delete`), operator functions
(`fn +`, `fn []=`, `fn ()`), closures (`|x| x * 2`, `move |x| { }`), the `?` operator, types (`i8`..`i64`,
`isize`, `u8`..`u64`, `usize`, `f32`, `f64`, `bool`, `void`, `str`, `*T`, `[]T`, `[]mut T`, `[T; N]`, tuples),
attributes (`@entry`, `@init`, `@fini`, `@repr(c)`, `@library("x")`, ...), `#if` directives, macro calls
(`f!(...)`), builtins (`syscall`, `sizeOf`, `__builtin_*`, `MemoryOrder`), literals (hex, binary, floats,
strings, bytes `b'x'`), block and doc comments, `:=`, `..` and `..=`.

### IntelliSense and hover

| Feature | Description |
|---------|-------------|
| **Completion** | Keywords, types, builtins, attributes (`@`), directives (`#`), predefined `#if` names and values (`os == "linux"`), roles (`register(panic)`), locals, parameters and every name visible through imports |
| **Member access** | `p.` completes fields and methods (own, inherited, from `impl` blocks), `Color.` value-enum members, `Expr.` payload variants, `ns.` namespace members |
| **Import paths** | Inside `from "..." import`, `import "..."` and `export * from "..."`: the standard library, installed packages and nearby modules, with what they export |
| **Hover** | Signatures (generics included) and `///` doc comments, docs of keywords and builtins, diagnostic code descriptions (`E0709`) |
| **Go to definition** | Symbols, members and the module file named by an import string, packages included |
| **Locals** | Types are followed through `local x := v`, `local (q, r) = f()`, `for x, i in s`, `catch e` and `case Expr.Add(a, b)` |

The extension parses `.xl` sources locally (no language server); the compiler is the authority and reports
the real errors.

### Diagnostics

Runs `xlc --check` on open and save (and while typing when `xlang.diagnosticsOnType` is on, through a
temporary copy next to the file). Errors and warnings keep their codes (`E0709`, `W0701`, ...), exact ranges,
the pinpoint text, `detail`, `reason`, the `fix` hint, and the labels and notes as related locations.
Problems found in an imported file are shown on the first line of the importing file.

### Commands

| Command | Action |
|---------|--------|
| **xlang: Run Current File** | Build and run the file in a terminal |
| **xlang: Build Current File** | Build an executable next to the file |
| **xlang: Check Current File** | `xlc --check`, output in the *xlang* channel |
| **xlang: Test Current File** | Build and run a `*.test.xl` file (or the suite from another file) |
| **xlang: Run Test Suite** | Build and run every `*.test.xl` under `xlang.testRoot` |
| **xlang: Show Type Layouts / Show LLVM IR / Show HIR** | Compiler dumps of the active file |
| **xlang: Explain Diagnostic Code** | `xlc --explain <CODE>` |
| **xlang: Show Compiler, Std and Module Roots** | The compiler, std and `-M` roots in use |
| **xlang: Package Add / Install / Update / Remove / List / Clean** | `xl pkg add\|install\|update\|remove\|list\|clean` in the project directory |
| **xlang: Toolchain Install / Update** | `xl lc install\|update`: the per-user compiler and stdlib |
| **xlang: Format Document** | Built-in brace based formatter |

The status bar shows the `xlc` version in use; click it for the module roots.

### Snippets

`fn`, `fng`, `main`, `init`, `fini`, `local`, `locali`, `tuple`, `const`, `struct`, `class`, `classdrop`,
`interface`, `impl`, `impltype`, `fnop`, `closure`, `move`, `enum`, `enump`, `enumg`, `switchp`, `define`, `if`, `while`, `for`, `forin`, `foreach`,
`switch`, `defer`, `try`, `new`, `delete`, `from`, `importpkg`, `declare`, `library`, `registerpanic`,
`registeralloc`, `#if`, `testfile`, and more: see `snippets/xlang.json`.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `xlang.compilerPath` | *(auto)* | Path to `xlc` (auto: the one `xl env` names, a build in the workspace or its `xlc/` submodule, `~/.local/bin/xlc`, then `PATH`) |
| `xlang.cliPath` | *(auto)* | Path to `xl`, used for `xl env`, `xl pkg` and `xl lc` (default: `xl` on `PATH`) |
| `xlang.useXlEnv` | `true` | Ask `xl env --json` for the build environment; off = the extension reads the files itself |
| `xlang.stdPath` | *(auto)* | Directory with the stdlib sources (`index.xl`); the strongest stdlib override (`xl env --std`) |
| `xlang.noStd` | `false` | No `-M std`, `--import std` or `-DfeatureDefaultAllocator=true` |
| `xlang.enableDiagnostics` | `true` | Run `xlc --check` on open/save |
| `xlang.diagnosticsOnType` | `false` | Re-check while typing (debounced) |
| `xlang.defines` | `[]` | Extra `-D NAME[=VALUE]` flags |
| `xlang.target` | *(host)* | `--target` triple |
| `xlang.safety` | *(compiler default)* | `--safety checked\|unchecked` |
| `xlang.optLevel` | *(compiler default)* | `-O0`..`-O3` |
| `xlang.extraArgs` | `[]` | Further `xlc` arguments for every call |
| `xlang.formatter.tabSize` | `4` | Indent size of the formatter |
| `xlang.testRoot` | `test` | Folder searched for `*.test.xl` by the suite command |

## Development

```bash
bun install
bun run compile      # -> out/extension.js
bun run typecheck    # tsc --noEmit
bun test             # parser, TOML and package resolution tests
bun run watch        # rebuild on change
bun run package      # -> xlang-<version>.vsix
```

Press **F5** in VS Code to launch an Extension Development Host.

### Layout

```
├── src/
│   ├── extension.ts       # activation, commands, watchers, status bar, quick fixes
│   ├── compiler.ts        # xlc discovery, flag building (-M, --import, -D, ...), process helper
│   ├── runner.ts          # terminal that builds and runs programs and tests
│   ├── diagnostics.ts     # `xlc --check --diag-format json` integration
│   ├── project.ts         # the build environment as xl env computes it: toolchain.toml, xlang.toml, xlang.lock, xlang.local.toml (no VS Code API)
│   ├── environment.ts     # asks xl env --json, falls back to project.ts, caches per project (no VS Code API)
│   ├── toml.ts            # reader of the TOML subset (no VS Code API)
│   ├── paths.ts           # std root, module roots, import resolution and path listing
│   ├── parser.ts          # line based .xl declaration parser (no VS Code API)
│   ├── symbols.ts         # hover / completion presentation of symbols
│   ├── languageIndex.ts   # import resolution, members, scopes
│   ├── completions.ts     # CompletionItemProvider
│   ├── hover.ts           # Hover + Definition providers
│   ├── builtins.ts        # keyword / type / builtin / attribute / role catalog
│   ├── diagnosticCodes.ts # titles of the compiler's diagnostic codes
│   └── formatter.ts
├── test/                  # bun tests of the pure modules
├── syntaxes/              # TextMate grammar
├── snippets/
└── language-configuration.json
```

## Example

```xl
from "std" import println

enum Color { Red, Green, Blue }

fn classify(c: Color) -> i32 {
    switch c {
        case Color.Red { return 1 }
        default { return 2 }
    }
}

@entry fn main() -> i32 {
    local total := 0
    for i in 0..4 {
        defer total += 1
        if i == 2 { continue }
        total += classify(Color.Green)
    }
    println("done")
    return 0
}
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
