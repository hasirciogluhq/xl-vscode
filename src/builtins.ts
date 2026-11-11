import * as vscode from "vscode";

export interface CatalogEntry {
  label: string;
  detail: string;
  documentation: string;
  insertText?: string;
  kind?: vscode.CompletionItemKind;
}

const K = vscode.CompletionItemKind;

function kw(label: string, documentation: string, insertText?: string): CatalogEntry {
  return { label, detail: "keyword", documentation, insertText, kind: K.Keyword };
}

export const KEYWORDS: CatalogEntry[] = [
  kw("fn", "Declares a function: `fn name(a: i32) -> i32 { }`. Without `->` the return type is `void`."),
  kw("local", "Declares a local variable: `local x: i32 = 0` or `local x = 0`."),
  kw("global", "Declares a global variable. The initializer must be a compile-time constant; without one the value is zero."),
  kw("return", "Returns from the current function, optionally with a value."),
  kw("if", "Conditional branch: `if cond { } else { }`."),
  kw("else", "Alternative branch of `if` (`else if` chains)."),
  kw("while", "Loop while the condition holds: `while cond { }`."),
  kw("do", "`do { } while cond` runs the body once, then tests the condition."),
  kw("for", "`for init; cond; step { }` or the range loop `for i in lo..hi { }` (upper bound exclusive). Also joins `impl Interface for Type`."),
  kw("break", "Leaves the innermost loop, or the loop named by a label: `break outer`."),
  kw("continue", "Next iteration of the innermost loop (a `for` runs its step), or of a labeled loop: `continue outer`."),
  kw("switch", "`switch v { case 1, 2 { } default { } }`. Integers, bools and enums; no fallthrough; `break` leaves the enclosing loop."),
  kw("case", "One arm of a `switch`: `case a, b { ... }`."),
  kw("default", "The fallback arm of a `switch`."),
  kw("defer", "`defer stmt` runs `stmt` when the enclosing block is left (fall off, `return`, `break`, `continue`), last in first out."),
  kw("unsafe", "`unsafe { }` accepts implicit signedness-changing integer conversions inside the block. It relaxes nothing else."),
  kw("import", "Imports from a module: `import * from \"m\"`, `import * as a from \"m\"`, `import x from \"m\"`, `import \"m\"`."),
  kw("from", "`from \"m\" import x, y as z` imports names from a module."),
  kw("as", "Explicit conversion (`x as i64`) or an import alias (`import * as a from \"m\"`)."),
  kw("export", "Makes a declaration visible to other xl modules. `export(c)` also gives it an unmangled C symbol."),
  kw("declare", "Declares a symbol defined in another object or library: `declare fn`, `declare global`, `declare struct`, ..."),
  kw("register", "`register(role) decl` binds a global role (`panic`, `allocator`); the declared name becomes global and exported."),
  kw("struct", "Declares a struct (value type)."),
  kw("class", "Declares a class: single inheritance, vptr, `virtual` / `override` methods."),
  kw("interface", "Declares an interface; values are fat pointers `{data, itable}`. Implemented with an explicit `impl`."),
  kw("impl", "`impl Interface for Type { ... }` implements an interface (nominal)."),
  kw("enum", "Declares an enum: `enum Name: T { A, B = 5 }` (default underlying type `i32`)."),
  kw("type", "Transparent type alias: `type Name = T`."),
  kw("define", "Compile-time constant (`define N = 4`) or hygienic macro (`define f(x: expr) { }`, called as `f!(...)`)."),
  kw("new", "`new T { fields }` or `new(a) T { fields }` allocates through the registered or given allocator and returns `*T`."),
  kw("virtual", "Marks a class method as virtual (dispatched through the vtable)."),
  kw("override", "Replaces a virtual method of a base class."),
  kw("self", "The receiver of a method."),
  kw("except", "`export * from \"m\" except a, b` re-exports everything but the listed names."),
  { label: "true", detail: "literal", documentation: "Boolean true.", kind: K.Constant },
  { label: "false", detail: "literal", documentation: "Boolean false.", kind: K.Constant },
  { label: "nil", detail: "constant", documentation: "The null pointer / null function pointer constant.", kind: K.Constant },
];

function ty(label: string, documentation: string): CatalogEntry {
  return { label, detail: "type", documentation, kind: K.TypeParameter };
}

export const TYPES: CatalogEntry[] = [
  ty("i8", "8-bit signed integer."),
  ty("i16", "16-bit signed integer."),
  ty("i32", "32-bit signed integer."),
  ty("i64", "64-bit signed integer."),
  ty("isize", "Pointer-sized signed integer."),
  ty("ui8", "8-bit unsigned integer (also the byte type; strings are `*ui8`)."),
  ty("ui16", "16-bit unsigned integer."),
  ty("ui32", "32-bit unsigned integer."),
  ty("ui64", "64-bit unsigned integer."),
  ty("usize", "Pointer-sized unsigned integer."),
  ty("f32", "32-bit float."),
  ty("f64", "64-bit float."),
  ty("bool", "Boolean."),
  ty("void", "No value. `*void` is the untyped pointer."),
];

export const BUILTINS: CatalogEntry[] = [
  {
    label: "syscall",
    detail: "syscall(nr, args...) -> i64",
    documentation:
      "Raw system call. The argument count is checked against the target maximum. Arguments may be any integer type or `*T`. Returns `-errno` on error on every target.",
    insertText: "syscall(${1:nr}${2})",
    kind: K.Function,
  },
  {
    label: "sizeOf",
    detail: "sizeOf(T) -> usize",
    documentation: "Size of a type in bytes (compile-time constant).",
    insertText: "sizeOf(${1:T})",
    kind: K.Function,
  },
  {
    label: "alignOf",
    detail: "alignOf(T) -> usize",
    documentation: "Alignment of a type in bytes (compile-time constant).",
    insertText: "alignOf(${1:T})",
    kind: K.Function,
  },
  {
    label: "offsetOf",
    detail: "offsetOf(T, field) -> usize",
    documentation: "Byte offset of a field (compile-time constant).",
    insertText: "offsetOf(${1:T}, ${2:field})",
    kind: K.Function,
  },
  {
    label: "staticAssert",
    detail: "staticAssert(cond, message)",
    documentation: "Compile-time assertion; a false condition is a compile error carrying the message.",
    insertText: 'staticAssert(${1:cond}, "${2:message}")',
    kind: K.Function,
  },
  {
    label: "__builtin_atomicLoad",
    detail: "__builtin_atomicLoad(ptr, order) -> T",
    documentation: "Atomic load. `order` is a `MemoryOrder` member (not `release` / `acqRel`).",
    insertText: "__builtin_atomicLoad(${1:ptr}, MemoryOrder.${2:seqCst})",
    kind: K.Function,
  },
  {
    label: "__builtin_atomicStore",
    detail: "__builtin_atomicStore(ptr, value, order)",
    documentation: "Atomic store.",
    insertText: "__builtin_atomicStore(${1:ptr}, ${2:value}, MemoryOrder.${3:seqCst})",
    kind: K.Function,
  },
  {
    label: "__builtin_atomicXchg",
    detail: "__builtin_atomicXchg(ptr, value, order) -> T",
    documentation: "Atomic exchange; returns the old value.",
    insertText: "__builtin_atomicXchg(${1:ptr}, ${2:value}, MemoryOrder.${3:seqCst})",
    kind: K.Function,
  },
  {
    label: "__builtin_atomicCas",
    detail: "__builtin_atomicCas(ptr, expected, desired, order) -> T",
    documentation: "Atomic compare-and-swap; returns the old value.",
    insertText: "__builtin_atomicCas(${1:ptr}, ${2:expected}, ${3:desired}, MemoryOrder.${4:seqCst})",
    kind: K.Function,
  },
  {
    label: "__builtin_atomicAdd",
    detail: "__builtin_atomicAdd(ptr, value, order) -> T",
    documentation: "Atomic add; returns the old value.",
    insertText: "__builtin_atomicAdd(${1:ptr}, ${2:value}, MemoryOrder.${3:seqCst})",
    kind: K.Function,
  },
  {
    label: "__builtin_fence",
    detail: "__builtin_fence(order)",
    documentation: "Memory fence. `order` cannot be `relaxed`.",
    insertText: "__builtin_fence(MemoryOrder.${1:seqCst})",
    kind: K.Function,
  },
  {
    label: "__builtin_asm",
    detail: '__builtin_asm("template", in(reg) x, out(reg) y, clobber("cc"), options(...))',
    documentation:
      "Inline assembly. The template is target specific (choose it with `#if arch` / `#if os`); Intel dialect on x86; `{0}` placeholders by operand order. Memory is assumed touched unless `options(\"nomem\")`; `options(\"noreturn\")` marks a non-returning block.",
    insertText: '__builtin_asm("${1:nop}"${2})',
    kind: K.Function,
  },
  {
    label: "MemoryOrder",
    detail: "builtin enum",
    documentation: "Memory order of atomics: `relaxed`, `acquire`, `release`, `acqRel`, `seqCst`.",
    kind: K.Enum,
  },
];

export const MEMORY_ORDERS: CatalogEntry[] = ["relaxed", "acquire", "release", "acqRel", "seqCst"].map(
  (m) => ({
    label: m,
    detail: "MemoryOrder",
    documentation: `\`MemoryOrder.${m}\``,
    kind: K.EnumMember,
  })
);

export const ATTRIBUTES: CatalogEntry[] = [
  {
    label: "repr",
    detail: "@repr(c)",
    documentation: "Gives a struct or class the C/C++ layout instead of the default xlang layout.",
    insertText: "repr(c)",
    kind: K.Property,
  },
  {
    label: "packed",
    detail: "@packed",
    documentation: "Removes padding between fields.",
    kind: K.Property,
  },
  {
    label: "align",
    detail: "@align(n)",
    documentation: "Sets the alignment of a type or field.",
    insertText: "align(${1:16})",
    kind: K.Property,
  },
  {
    label: "layout",
    detail: "@layout(...)",
    documentation: "Selects a frozen layout scheme version.",
    insertText: "layout(${1})",
    kind: K.Property,
  },
  {
    label: "mangle",
    detail: "@mangle(...)",
    documentation: "Overrides name mangling for a function (function > file > project).",
    insertText: 'mangle("${1:name}")',
    kind: K.Property,
  },
  {
    label: "library",
    detail: '@library("name")',
    documentation:
      "On a `declare fn`: the native OS library the function is imported from (Windows ntdll, ws2_32, ...). Only allowed in std/sys modules behind `#if os`.",
    insertText: 'library("${1:ntdll}")',
    kind: K.Property,
  },
  {
    label: "allow",
    detail: "@allow(CODE)",
    documentation: "Silences a warning for a statement, block or function: `@allow(W0601)`.",
    insertText: "allow(${1:W0601})",
    kind: K.Property,
  },
  {
    label: "file",
    detail: "@file(...)",
    documentation: "File-level setting at the top of the file: `@file(allow = W0601)`, `@file(mangle = ...)`.",
    insertText: "file(${1:allow = W0601})",
    kind: K.Property,
  },
];

export const DIRECTIVES: CatalogEntry[] = [
  { label: "#if", detail: "directive", documentation: "Conditional compilation. The condition uses normal expression syntax (`os == \"linux\"`, `arch == \"x86_64\"`, feature flags).", insertText: "#if ${1:os == \"linux\"}", kind: K.Keyword },
  { label: "#elif", detail: "directive", documentation: "Else-if branch of `#if`.", kind: K.Keyword },
  { label: "#else", detail: "directive", documentation: "Else branch of `#if`.", kind: K.Keyword },
  { label: "#endif", detail: "directive", documentation: "Ends an `#if` whose body starts on a later line.", kind: K.Keyword },
  { label: "#ifdef", detail: "directive", documentation: "True when the name is defined (`-D NAME`).", kind: K.Keyword },
  { label: "#ifndef", detail: "directive", documentation: "True when the name is not defined.", kind: K.Keyword },
  { label: "#error", detail: "directive", documentation: "Aborts the compilation with a message when the region is active.", kind: K.Keyword },
];

export const ROLES: CatalogEntry[] = [
  { label: "panic", detail: "register role", documentation: "`register(panic) fn(msg: *ui8)`, noreturn. Called by compiler inserted failure paths (division by zero, array bounds).", kind: K.Constant },
  { label: "allocator", detail: "register role", documentation: "`register(allocator) global x: Allocator`. `new T` calls its `alloc`; one registration per program.", kind: K.Constant },
];

export const DIAGNOSTIC_CODES: Record<string, string> = {
  E0302: "Non-C type in an `export(c)` signature.",
  E0501: "`new T` without a registered allocator (use `new(a) T`).",
  E0502: "Duplicate `register` for one role.",
  E0503: "A registered declaration does not meet its role contract.",
  E0504: "An interface is used without an `impl`.",
  E0601: "Implicit signedness-changing conversion; write `as` or use `unsafe`.",
  E0708: "Type mismatch.",
  E0709: "Invalid operation.",
  E0710: "Wrong number of arguments.",
  W0301: "A `declare`d symbol is not resolved in this compilation.",
  W0401: "The same entity arrives through two import paths.",
  W0402: "A local name shadows a registered one.",
  W0601: "Implicit signed integer to float conversion.",
  W0701: "A function can reach its end without returning a value.",
};

const POOLS: CatalogEntry[][] = [KEYWORDS, TYPES, BUILTINS, MEMORY_ORDERS, ATTRIBUTES, ROLES];

export function findCatalogEntry(name: string): CatalogEntry | undefined {
  for (const pool of POOLS) {
    const hit = pool.find((e) => e.label === name);
    if (hit) {
      return hit;
    }
  }
  return undefined;
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
