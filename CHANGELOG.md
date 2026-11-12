# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added
- The build environment comes from `xl env --json <file>`: compiler, stdlib, package roots and `[build] flags`, with a built-in fallback that reads `toolchain.toml`, `xlang.toml`, `xlang.lock` and `xlang.local.toml` the same way. New setting `xlang.useXlEnv`.
- `xlang.local.toml` (`[toolchain]`, `[modules]`, `[build] flags`) and `$XLANG_HOME/toolchain.toml` are watched.
- Commands *Package Add*, *Toolchain Install* and *Toolchain Update* (`xl pkg add`, `xl lc install|update`).
- Highlighting of closures (`|x|`, `move |x|`), the `?` operator, operator functions (`fn +`, `fn []=`, `fn ()`) and inherent `impl<T> Type<T>` blocks; snippets `impltype`, `fnop`, `closure`, `move`.
- Diagnostic titles for E0761–E0777, W0770, W0771 and the `xl` codes E0790–E0793.

### Changed
- Package commands run `xl pkg <command>`.
- `-DfeatureDefaultAllocator=true` is always passed with the stdlib.

### Removed
- The `xlang.features` setting and `[std]` of `xlang.toml`.
- Octal literal highlighting (the language has none).

## [1.0.0]

### Added
- Syntax highlighting, snippets, completion, hover and go-to-definition for xlang (`.xl`, `*.test.xl`).
- Package-aware module resolution from `xlang.toml`, `xlang.lock` and `.xlang/cache`.
- Diagnostics from `xlc`, formatter, and run / build / test / layout / IR / package commands.
