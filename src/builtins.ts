import * as vscode from "vscode";

export interface CatalogEntry {
  label: string;
  detail: string;
  documentation: string;
  insertText?: string;
  kind?: vscode.CompletionItemKind;
}

const K = vscode.CompletionItemKind;

const kw = (label: string, documentation: string, insertText?: string): CatalogEntry => ({
  label,
  detail: "keyword",
  documentation,
  insertText,
  kind: K.Keyword,
});

export const KEYWORDS: CatalogEntry[] = [
  kw("fn", "Declares a function: `fn name(a: i32) -> i32 { }`. Without `->` the return type is `void`. `fn(A) -> R` is also the function-pointer type, and `fn(x: i32) { }` in an expression is a function literal. `fn out = io.print` declares an alias."),
  kw("local", "Declares a local: `local x: i32 = 0`, `local x = 0`, `local x := 0` (type inferred), or a tuple taken apart: `local (q, r) = divMod(7, 3)`."),
  kw("global", "Declares a global. The initializer must be a compile-time constant; without one the value is zero."),
  kw("const", "A named compile-time constant that cannot be written: `const LIMIT: i32 = 7`, `const GREETING = \"hi\"`. Allowed at module level and as a statement in a block. Emitted as read-only data."),
  kw("return", "Returns from the current function, optionally with a value."),
  kw("if", "Conditional branch: `if cond { } else if other { } else { }`. No parentheses; bodies always use braces."),
  kw("else", "Alternative branch of `if` (`else if` chains)."),
  kw("while", "Loop while the condition holds: `while cond { }`."),
  kw("do", "`do { } while cond` runs the body once, then tests the condition."),
  kw("for", "`for init; cond; step { }`, `for i in lo..hi { }` (upper bound excluded), `for i in lo..=hi { }` (included), and the iterating `for x, i in s { }` over an array, slice or `str` (`x` points into the storage, `i` is the `usize` index). Also joins `impl Interface for Type`."),
  kw("in", "`for name in lo..hi`, `for x in slice`, `for x, i in slice`."),
  kw("break", "Leaves the innermost loop, or the loop named by a label: `break outer`."),
  kw("continue", "Next iteration of the innermost loop (a `for` runs its step), or of a labeled loop: `continue outer`."),
  kw("switch", "`switch v { case 1, 2 { } default { } }`. Integers, bools, enums and payload enums (`case Expr.Add(a, b) { }`); no fallthrough; a `break` leaves the enclosing loop."),
  kw("case", "One arm of a `switch`: `case a, b { ... }`, or a payload pattern `case Expr.Add(a, b) { ... }` (`_` ignores a value)."),
  kw("default", "The fallback arm of a `switch`. Without it a payload-enum `switch` must name every variant (`E0750`)."),
  kw("defer", "`defer stmt` runs `stmt` when the enclosing block is left (fall off, `return`, `break`, `continue`), last in first out."),
  kw("try", "`try { } catch e { }` runs the body; a `panic` at any call depth continues in the `catch` block after the defers and drops in between have run. Needs the `unwind` role (`E0501` otherwise)."),
  kw("catch", "The handler of a `try`: `catch e { }` (`e: *u8`, the panic message) or `catch { }`. `panic(e)` rethrows."),
  kw("unsafe", "`unsafe { }` accepts implicit signedness-changing integer conversions inside the block. It relaxes nothing else."),
  kw("import", "Imports from a module: `import \"m\"`, `import \"m\" as a`, `import * from \"m\"`, `import * as a from \"m\"`, `import x, y from \"m\"`."),
  kw("from", "`from \"m\" import x, y as z` imports names from a module."),
  kw("as", "Explicit conversion (`x as i64`) or an import alias (`import \"m\" as a`, `from \"m\" import x as y`)."),
  kw("export", "Makes a declaration visible to importers. `export(c)` also keeps the C symbol name unmangled. Also re-exports: `export * from \"m\"`, `export { a, b } from \"m\"`."),
  kw("declare", "Declares a symbol defined elsewhere (another object or a native library): `declare fn name(x: i32) -> i32`. `@library(\"name\")` names the OS library."),
  kw("register", "`register(role) decl` makes a declaration global under a role: `panic`, `alloc`, `free` or `unwind`. A user registration replaces the library default."),
  kw("struct", "Declares a struct: plain data, no methods. A field that needs drop is `E0721`. `@repr(c)` selects C layout."),
  kw("class", "Declares a class: methods, single inheritance (`class Dog : Animal`), a vptr, `virtual`/`override`, `fn init(self, ...)` and `fn drop(self)`."),
  kw("interface", "Declares an interface; values are fat pointers `{data, table}` that borrow their object. Implemented explicitly with `impl`."),
  kw("impl", "`impl Interface for Type { ... }` implements an interface (nominal). Generic: `impl<T> Iter<T> for Cell<T>`."),
  kw("enum", "`enum Name: T { A, B = 5 }` names constants; `enum Expr { Num(i64) Add(*Expr, *Expr) Nil }` is a payload enum (a tagged union); both may be generic: `enum Result<T, E> { Ok(T) Err(E) }`."),
  kw("type", "Transparent type alias: `type Name = T`, generic: `type Pair<T> = (T, T)`."),
  kw("define", "Compile-time constant (`define N = 4`) or hygienic macro (`define f(x: expr) { }`, called as `f!(...)`). Macro parameter kinds: `expr`, `type`, `ident`, `block`, `items`."),
  kw("new", "`new T(args)` / `new T { fields }` allocates through the registered `alloc` and returns `*T`; `new(p) T(...)` constructs in the memory `p` points at."),
  kw("delete", "`delete p` runs the drop of the pointee when it needs drop, then releases the memory through the registered `free`."),
  kw("virtual", "Marks a class method as virtual (dispatched through the vtable)."),
  kw("override", "Replaces a virtual method of a base class."),
  kw("self", "The receiver of a method."),
  kw("except", "`export * from \"m\" except a, b` re-exports everything but the listed names."),
  kw("mut", "`[]mut T` is the writable slice (same layout as `[]T`; `mut` is a permission, not an aliasing guarantee)."),
  { label: "true", detail: "literal", documentation: "Boolean true.", kind: K.Constant },
  { label: "false", detail: "literal", documentation: "Boolean false.", kind: K.Constant },
  { label: "nil", detail: "constant", documentation: "The null pointer / null function pointer constant.", kind: K.Constant },
];

const ty = (label: string, documentation: string): CatalogEntry => ({
  label,
  detail: "type",
  documentation,
  kind: K.TypeParameter,
});

export const TYPES: CatalogEntry[] = [
  ty("i8", "8-bit signed integer."),
  ty("i16", "16-bit signed integer."),
  ty("i32", "32-bit signed integer."),
  ty("i64", "64-bit signed integer."),
  ty("isize", "Pointer-sized signed integer."),
  ty("u8", "8-bit unsigned integer, the byte type. `*u8` is a C string pointer; `b'x'` is a `u8` literal."),
  ty("u16", "16-bit unsigned integer."),
  ty("u32", "32-bit unsigned integer."),
  ty("u64", "64-bit unsigned integer."),
  ty("usize", "Pointer-sized unsigned integer."),
  ty("f32", "32-bit float."),
  ty("f64", "64-bit float."),
  ty("bool", "Boolean."),
  ty("void", "No value. `*void` is the untyped pointer."),
  ty("str", "Built-in read-only view `{ ptr: *u8, len: usize }`; it never owns its bytes. `s[a..b]` is a sub-view, `s[i]` reads a byte. Compare with `eq` from `std/str`."),
];

const builtin = (label: string, detail: string, documentation: string, insertText?: string): CatalogEntry => ({
  label,
  detail,
  documentation,
  insertText,
  kind: K.Function,
});

export const BUILTINS: CatalogEntry[] = [
  builtin("syscall", "syscall(nr, args...) -> i64", "Raw system call. The argument count is checked against the target maximum. Arguments are integers or pointers. Returns `-errno` on error on every target.", "syscall(${1:nr}${2})"),
  builtin("sizeOf", "sizeOf(T) -> usize", "Size of a type in bytes (compile-time constant).", "sizeOf(${1:T})"),
  builtin("alignOf", "alignOf(T) -> usize", "Alignment of a type in bytes (compile-time constant).", "alignOf(${1:T})"),
  builtin("offsetOf", "offsetOf(T, field) -> usize", "Byte offset of a field (compile-time constant).", "offsetOf(${1:T}, ${2:field})"),
  builtin("staticAssert", "staticAssert(cond[, message])", "Compile-time assertion; a false condition fails the build (`E0702`). The message is optional.", "staticAssert(${1:cond})"),
  builtin("__builtin_atomicLoad", "__builtin_atomicLoad(ptr, order) -> T", "Atomic load. `order` is a `MemoryOrder` member (not `release` / `acqRel`).", "__builtin_atomicLoad(${1:ptr}, MemoryOrder.${2:seqCst})"),
  builtin("__builtin_atomicStore", "__builtin_atomicStore(ptr, value, order)", "Atomic store.", "__builtin_atomicStore(${1:ptr}, ${2:value}, MemoryOrder.${3:seqCst})"),
  builtin("__builtin_atomicXchg", "__builtin_atomicXchg(ptr, value, order) -> T", "Atomic exchange; returns the old value.", "__builtin_atomicXchg(${1:ptr}, ${2:value}, MemoryOrder.${3:seqCst})"),
  builtin("__builtin_atomicCas", "__builtin_atomicCas(ptr, expected, desired, order) -> T", "Atomic compare-and-swap; returns the old value.", "__builtin_atomicCas(${1:ptr}, ${2:expected}, ${3:desired}, MemoryOrder.${4:seqCst})"),
  builtin("__builtin_atomicAdd", "__builtin_atomicAdd(ptr, value, order) -> T", "Atomic add; returns the old value.", "__builtin_atomicAdd(${1:ptr}, ${2:value}, MemoryOrder.${3:seqCst})"),
  builtin("__builtin_fence", "__builtin_fence(order)", "Memory fence. `order` cannot be `relaxed`.", "__builtin_fence(MemoryOrder.${1:seqCst})"),
  builtin("__builtin_asm", '__builtin_asm("template", in(reg) x, out(reg) y, clobber("cc"), options(...))', "Inline assembly. The template is target specific (choose it with `#if arch` / `#if os`); Intel dialect on x86; `{0}` placeholders by operand order. Memory is assumed touched unless `options(\"nomem\")`; `options(\"noreturn\")` marks a non-returning block.", '__builtin_asm("${1:nop}"${2})'),
  builtin("__builtin_needsDrop", "__builtin_needsDrop<T>() -> bool", "Compile-time `bool`: true when `T` needs drop. The type goes in angle brackets because a type is not an expression.", "__builtin_needsDrop<${1:T}>()"),
  builtin("__builtin_drop", "__builtin_drop(p)", "Runs the drop glue of the pointee of `p`; nothing when the pointee needs no drop. It does not free the memory.", "__builtin_drop(${1:p})"),
  builtin("__builtin_read", "__builtin_read(p) -> T", "The value stored at `p`, copied out with no move and no drop. The caller owns the copy. Unchecked, like `*p`.", "__builtin_read(${1:p})"),
  builtin("__builtin_write", "__builtin_write(p, v)", "Statement: stores `v` at `p` without dropping the old value; a droppable `v` is moved in. Unchecked.", "__builtin_write(${1:p}, ${2:v})"),
  builtin("__builtin_unwindPads", "__builtin_unwindPads()", "The landing-pad table the stdlib unwinder walks (behind the `unwind` role)."),
  builtin("__builtin_unwindPadCount", "__builtin_unwindPadCount() -> usize", "Number of entries of the landing-pad table."),
  { label: "MemoryOrder", detail: "builtin enum", documentation: "Memory order of atomics: `relaxed`, `acquire`, `release`, `acqRel`, `seqCst`.", kind: K.Enum },
];

export const MEMORY_ORDERS: CatalogEntry[] = ["relaxed", "acquire", "release", "acqRel", "seqCst"].map((m) => ({
  label: m,
  detail: "MemoryOrder",
  documentation: `\`MemoryOrder.${m}\``,
  kind: K.EnumMember,
}));

const attr = (label: string, detail: string, documentation: string, insertText?: string): CatalogEntry => ({
  label,
  detail,
  documentation,
  insertText,
  kind: K.Property,
});

export const ATTRIBUTES: CatalogEntry[] = [
  attr("entry", "@entry", "Marks the program's entry function, at most one (`E0753`): `@entry fn main() -> i32` or `@entry fn main(argc: i32, argv: **u8) -> i32`. The compiler generates the process start-up (`_start`, `mainCRTStartup`) from it."),
  attr("init", "@init", "Module-level boot function: `@init fn boot() { }`. Runs before `@entry`: library group first, then the program; a module's imports run before the module."),
  attr("fini", "@fini", "Module-level teardown function with the same form as `@init`; runs after `@entry`, in reverse `@init` order."),
  attr("repr", "@repr(c)", "Gives a struct or class the C layout instead of the default xl layout.", "repr(c)"),
  attr("packed", "@packed", "Removes padding between fields."),
  attr("align", "@align(n)", "Sets the alignment of a type or field.", "align(${1:16})"),
  attr("layout", "@layout(...)", "Selects a frozen layout scheme version.", "layout(${1})"),
  attr("mangle", "@mangle(...)", "Overrides name mangling for a function (function > file > project).", 'mangle("${1:name}")'),
  attr("library", '@library("name")', "On a `declare fn`: the OS runtime library the function is imported from (`System` on macOS, ntdll / kernel32 / ws2_32 on Windows). Only the standard library calls them; user code goes through stdlib functions.", 'library("${1:ntdll}")'),
  attr("allow", "@allow(CODE)", "Silences a warning for a statement, block or function: `@allow(W0601)`.", "allow(${1:W0601})"),
  attr("file", "@file(...)", "File-level setting at the top of the file: `@file(allow = W0601)`, `@file(mangle = ...)`.", "file(${1:allow = W0601})"),
];

export const DIRECTIVES: CatalogEntry[] = [
  { label: "#if", detail: "directive", documentation: "Conditional compilation. The condition is a normal expression: `os == \"linux\" && arch == \"x86_64\"`, `featureDefaultAllocator`.", insertText: '#if ${1:os == "linux"}', kind: K.Keyword },
  { label: "#elif", detail: "directive", documentation: "Else-if branch of `#if`.", insertText: '#elif ${1:os == "macos"}', kind: K.Keyword },
  { label: "#else", detail: "directive", documentation: "Else branch of `#if`.", kind: K.Keyword },
  { label: "#endif", detail: "directive", documentation: "Ends an `#if`.", kind: K.Keyword },
  { label: "#ifdef", detail: "directive", documentation: "True when the name is defined (`-DNAME`).", insertText: "#ifdef ${1:NAME}", kind: K.Keyword },
  { label: "#ifndef", detail: "directive", documentation: "True when the name is not defined.", insertText: "#ifndef ${1:NAME}", kind: K.Keyword },
  { label: "#error", detail: "directive", documentation: "Aborts the compilation with a message when the region is active.", insertText: '#error "${1:message}"', kind: K.Keyword },
];

export const ROLES: CatalogEntry[] = [
  { label: "panic", detail: "register role", documentation: "`register(panic) fn name(msg: *u8)`: what the compiler's failure paths (division by zero, array bounds) call.", kind: K.Constant },
  { label: "alloc", detail: "register role", documentation: "`register(alloc) fn name(size: usize, align: usize) -> *void`: what `new T` calls. Pair it with a `free`.", kind: K.Constant },
  { label: "free", detail: "register role", documentation: "`register(free) fn name(p: *void)`: what `delete p` calls.", kind: K.Constant },
  { label: "unwind", detail: "register role", documentation: "`register(unwind) fn name(op: i32, snapshot: *usize, message: *u8)`: the panic walker `try` / `catch` run on. Without it `try` is `E0501`.", kind: K.Constant },
];

/** Names an `#if` condition can read without a `-D`; the values are what the target gives them. */
export const PREDEFINED: { name: string; documentation: string; values?: string[] }[] = [
  { name: "os", documentation: "Target operating system (string).", values: ["linux", "macos", "windows"] },
  { name: "arch", documentation: "Target CPU architecture (string).", values: ["x86_64", "aarch64"] },
  { name: "pointerWidth", documentation: "Pointer width in bits (integer): 32 or 64." },
  { name: "endian", documentation: "Byte order (string).", values: ["little", "big"] },
  { name: "debug", documentation: "`true` with `-g` (bool)." },
  { name: "optLevel", documentation: "The `-O` level, 0 to 3 (integer)." },
  { name: "featureDefaultAllocator", documentation: "Standard library feature: the default `alloc` / `free` registrations. Set with `-DfeatureDefaultAllocator=true` (the extension's `xlang.features` setting does this)." },
];

const POOLS: CatalogEntry[] = [...KEYWORDS, ...TYPES, ...BUILTINS, ...MEMORY_ORDERS, ...ATTRIBUTES, ...ROLES];

export function findCatalogEntry(name: string): CatalogEntry | undefined {
  return POOLS.find((e) => e.label === name);
}

export function catalogToCompletion(entry: CatalogEntry, sortPrefix: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(entry.label, entry.kind ?? K.Text);
  item.detail = entry.detail;
  item.documentation = new vscode.MarkdownString(entry.documentation);
  item.sortText = `${sortPrefix}_${entry.label}`;
  if (entry.insertText) {
    item.insertText = new vscode.SnippetString(entry.insertText);
  }
  return item;
}

export function catalogToHover(entry: CatalogEntry): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${entry.label}** \`${entry.detail}\`\n\n`);
  md.appendMarkdown(entry.documentation);
  return md;
}
