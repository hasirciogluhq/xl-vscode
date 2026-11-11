# xlang — VS Code Extension

Language support for **xlang** (`.xl`, `*.test.xl`): syntax highlighting, IntelliSense, hover docs,
go-to-definition, compiler diagnostics, formatting, snippets and run / build / test commands.

Built with **Bun** + TypeScript. It needs the [`xlang`](https://github.com/hasirciogluhq/xlang#readme)
compiler for diagnostics and the commands.

## Features

### Highlighting

Keywords and control flow (`while`, `do`, `for`, `break`, `continue`, `switch`, `defer`, `unsafe`),
declarations (`fn`, `struct`, `class`, `interface`, `impl`, `enum`, `type`, `define`, `global`,
`register`), types (`i8`..`i64`, `isize`, `ui8`..`ui64`, `usize`, `f32`, `f64`, `bool`, `void`, `*T`,
`[T; N]`), attributes (`@repr(c)`, `@library("x")`, ...), `#if` directives, macro calls (`f!(...)`),
builtins (`syscall`, `sizeOf`, `__builtin_*`, `MemoryOrder`), numbers (hex, binary, octal, floats),
compound assignment and the other operators.

### IntelliSense and hover

| Feature | Description |
|---------|-------------|
| **Completion** | Keywords, types, builtins, attributes (`@`), directives (`#`), `MemoryOrder.` members, roles, locals, parameters and every name visible through imports |
| **Member access** | `p.` completes fields and methods (own, inherited, from `impl` blocks), `Color.` enum members, `ns.` namespace members |
| **Import paths** | Inside `from "..." import`, `import "..."` and `export * from "..."` the stdlib (`std`, `std/mem`, ...) and nearby modules are suggested with their exports |
| **Hover** | Signatures and `///` doc comments of symbols, docs of keywords and builtins, diagnostic code descriptions (`E0709`) |
| **Go to definition** | Symbols, members and the module file named by an import string |

The extension parses `.xl` sources locally (no language server). Standard library modules come from a
`std/` directory: `xlang.stdPath`, a `std/` above the file, `std/` in a workspace folder, or `std/` next
to the compiler's build directory.

### Diagnostics

Runs `xlang check <file> --diag-format json` on open and save (and while typing when
`xlang.diagnosticsOnType` is on, through a temporary copy next to the file). Errors and warnings keep their
codes (`E0709`, `W0701`, ...), exact ranges, the pinpoint text, the fix hint and related locations.
Problems found in an imported file are shown on the first line of the importing file.

### Commands

| Command | Action |
|---------|--------|
| **xlang: Run Current File** | `xlang run <file>` in a terminal |
| **xlang: Build Current File** | `xlang build <file> -o <file without extension>` |
| **xlang: Check Current File** | `xlang check <file>`, output in the *xlang* channel |
| **xlang: Test Current File** | `xlang test <file>` (a `*.test.xl` file) or the suite |
| **xlang: Run Test Suite** | `xlang test <xlang.testRoot>` |
| **xlang: Explain Diagnostic Code** | `xlang --explain <CODE>` |
| **xlang: Format Document** | Built-in brace based formatter |

`xlang.defines` (`-D`) and `xlang.target` (`--target`) are passed to check, build, run and test.

### Snippets

`fn`, `main`, `struct`, `class`, `interface`, `impl`, `enum`, `define`, `if`, `while`, `do`, `for`,
`forin`, `switch`, `defer`, `unsafe`, `from`, `importas`, `declare`, `library`, `registerpanic`,
`#if`, `testfile`, and more: see `snippets/xlang.json`.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `xlang.compilerPath` | *(auto)* | Path to the `xlang` binary (auto: `outputs/xlang` in the workspace, then `PATH`) |
| `xlang.stdPath` | *(auto)* | Directory with the stdlib sources (`index.xl`) for IntelliSense |
| `xlang.enableDiagnostics` | `true` | Run `xlang check` on open/save |
| `xlang.diagnosticsOnType` | `false` | Re-check while typing (debounced) |
| `xlang.defines` | `[]` | Extra `-D NAME[=VALUE]` flags |
| `xlang.target` | *(host)* | `--target` triple |
| `xlang.formatter.tabSize` | `4` | Indent size of the formatter |
| `xlang.testRoot` | `test` | What the suite command passes to `xlang test` |

## Development

```bash
cd vscode
bun install
bun run compile      # -> out/extension.js
bun run watch        # rebuild on change
bun run package      # -> xlang-<version>.vsix
```

Press **F5** in VS Code to launch an Extension Development Host.

### Layout

```
vscode/
├── src/
│   ├── extension.ts      # activation, commands
│   ├── completions.ts    # CompletionItemProvider
│   ├── hover.ts          # Hover + Definition providers
│   ├── symbols.ts        # line based .xl declaration parser
│   ├── languageIndex.ts  # import resolution, members, scopes
│   ├── builtins.ts       # keyword / type / builtin / attribute catalog
│   ├── paths.ts          # module and stdlib resolution
│   ├── diagnostics.ts    # `xlang check` integration
│   └── formatter.ts
├── syntaxes/             # TextMate grammar
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

fn main() -> i32 {
    local total: i32 = 0
    for i in 0..4 {
        defer total += 1
        if i == 2 { continue }
        total += classify(Color.Green)
    }
    println("done")
    return 0
}
```

## License

MIT
