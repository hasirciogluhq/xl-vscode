// A line-based reader of xlang sources. The compiler is the authority on what a program means; this
// only feeds IntelliSense (symbols, members, locals, imports). It has no dependency on VS Code so it
// can be tested on its own.

import * as path from "node:path";

export type SymbolKind =
  | "function"
  | "method"
  | "struct"
  | "class"
  | "interface"
  | "enum"
  | "enumMember"
  | "type"
  | "define"
  | "const"
  | "global"
  | "variable"
  | "field"
  | "module";

export interface SymbolDoc {
  name: string;
  kind: SymbolKind;
  signature: string;
  detail: string;
  documentation: string;
  exported: boolean;
  /** Struct / class / interface / enum a member belongs to. */
  owner?: string;
  /** Return type of a function, declared or inferred type of a global / const. */
  returnType?: string;
  moduleId: string;
  filePath: string;
  line: number;
}

export interface FieldDoc {
  name: string;
  type: string;
  line: number;
}

/** A member of a value enum (`B = 5`) or a payload enum (`Add(*Expr, *Expr)`). */
export interface EnumMember {
  name: string;
  payload?: string[];
  value?: string;
}

export interface AggregateDoc {
  name: string;
  kind: "struct" | "class" | "interface" | "enum";
  generics?: string;
  base?: string;
  fields: FieldDoc[];
  methods: SymbolDoc[];
  members: EnumMember[];
  exported: boolean;
  filePath: string;
  line: number;
}

export interface ImportBinding {
  /** Name bound in the importing file (`a` of `import * as a`, the name of `import x`). */
  alias: string;
  modulePath: string;
  /** `star`: every export is visible without a prefix. */
  kind: "namespace" | "star" | "symbol";
  symbolName?: string;
}

export interface ReExport {
  modulePath: string;
  kind: "star" | "namespace" | "names";
  alias?: string;
  names?: { name: string; alias: string }[];
  except?: string[];
}

export interface ParamDoc {
  name: string;
  type: string;
}

export interface LocalDoc {
  name: string;
  type: string;
  line: number;
  /** Initializer text of a local whose type is not written, kept to infer it once the whole file is read. */
  init?: string;
}

export interface FunctionScope {
  name: string;
  owner?: string;
  startLine: number;
  endLine: number;
  params: ParamDoc[];
  locals: LocalDoc[];
}

export interface ParsedModule {
  moduleId: string;
  filePath: string;
  symbols: SymbolDoc[];
  aggregates: Map<string, AggregateDoc>;
  imports: ImportBinding[];
  reexports: ReExport[];
  functions: FunctionScope[];
}

// ---------------------------------------------------------------------------------------------
// Declaration patterns

const ATTRS = String.raw`(?:@\w+(?:\([^)]*\))?\s+)*`;
const MODS = String.raw`(?:(export)(?:\((\w+)\))?\s+)?(?:(declare)\s+)?(?:register(?:\(\w+\))?\s+)?`;
const GEN = String.raw`(?:<([^<>]*)>)?`;

// groups: 1 export, 2 abi, 3 declare, 4 name, 5 generics
const FN_RE = new RegExp(String.raw`^\s*${ATTRS}${MODS}(?:(?:virtual|override)\s+)*fn\s+(\w+)${GEN}\s*\(`);
// groups: 4 name, 5 target
const FN_ALIAS_RE = new RegExp(String.raw`^\s*${ATTRS}${MODS}fn\s+(\w+)\s*=\s*([\w./]+)`);
// groups: 4 kind, 5 name, 6 generics, 7 base
const STRUCT_RE = new RegExp(
  String.raw`^\s*${ATTRS}${MODS}(struct|class|interface)\s+(\w+)${GEN}(?:\s*:\s*([\w./]+(?:<[^<>]*>)?))?`
);
// groups: 4 name, 5 generics, 6 underlying type
const ENUM_RE = new RegExp(String.raw`^\s*${ATTRS}${MODS}enum\s+(\w+)${GEN}(?:\s*:\s*([^{]+?))?\s*\{?`);
const IMPL_RE = /^\s*impl(?:<[^<>]*>)?\s+[^{]+?\s+for\s+(\w+)/;
// groups: 4 name, 5 generics, 6 target
const TYPE_RE = new RegExp(String.raw`^\s*${MODS}type\s+(\w+)${GEN}\s*=\s*(.+?)\s*$`);
// groups: 4 name, 5 "(params)", 6 params, 7 value
const DEFINE_RE = new RegExp(String.raw`^\s*${MODS}define\s+(\w+)\s*(\(([^)]*)\))?\s*(?:=\s*(.+?))?\s*\{?\s*$`);
// groups: 4 name, 5 type
const GLOBAL_RE = new RegExp(String.raw`^\s*${ATTRS}${MODS}global\s+(\w+)\s*(?::\s*([^=]+?))?\s*(?:=.*)?$`);
// groups: 4 name, 5 type, 6 value
const CONST_RE = new RegExp(String.raw`^\s*${ATTRS}${MODS}const\s+(\w+)\s*(?::\s*([^=]+?))?\s*=\s*(.+?)\s*$`);

// Locals: `local x: T = v`, `local x = v`, `local x := v`, `const x = v`, `local (a, b) = f()`.
const LOCAL_RE = /^\s*(?:local|const)\s+(\w+)\s*(?::(?!=)\s*([^=]+?))?\s*(?::?=\s*(.+?))?\s*$/;
const TUPLE_LOCAL_RE = /^\s*local\s+\(([^)]*)\)\s*(?::\s*[^=]+?)?\s*:?=\s*(.+?)\s*$/;
const FOR_LOCAL_RE = /\bfor\s+(?:local|const)\s+(\w+)\s*(?::(?!=)\s*([^=;]+?))?\s*:?=\s*([^;]+)/;
const FOR_RANGE_RE = /\bfor\s+(\w+)\s+in\s+([^.]+?)\s*\.\./;
const FOR_EACH_RE = /\bfor\s+(\w+)\s*(?:,\s*(\w+)\s*)?in\s+([^{]+?)\s*(?:\{.*)?$/;
const CATCH_RE = /\bcatch\s+(\w+)\b/;
const CASE_PAYLOAD_RE = /\bcase\s+([\w.]+?)\.(\w+)\s*\(([^)]*)\)/;

const IMPORT_FROM_RE = /^\s*from\s+"([^"]+)"\s+import\s+(.+?)\s*$/;
const IMPORT_NAMES_RE = /^\s*import\s+(?!\*)(\w[\w\s,]*?)\s+from\s+"([^"]+)"\s*$/;
const IMPORT_STAR_RE = /^\s*import\s+\*\s+from\s+"([^"]+)"\s*$/;
const IMPORT_STAR_AS_RE = /^\s*import\s+\*\s+as\s+(\w+)\s+from\s+"([^"]+)"\s*$/;
const IMPORT_MODULE_RE = /^\s*import\s+"([^"]+)"(?:\s+as\s+(\w+))?\s*$/;
const EXPORT_STAR_RE = /^\s*export\s+\*\s+from\s+"([^"]+)"(?:\s+except\s+(.+?))?\s*$/;
const EXPORT_STAR_AS_RE = /^\s*export\s+\*\s+as\s+(\w+)\s+from\s+"([^"]+)"\s*$/;
const EXPORT_NAMES_RE = /^\s*export\s+\{([^}]*)\}\s+from\s+"([^"]+)"\s*$/;

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Replaces block comments by blanks (newlines stay), leaving strings and `//` comments alone. */
export function blankBlockComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"' && source[j] !== "\n") {
        j += source[j] === "\\" ? 2 : 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += source.slice(i, stop);
      i = stop;
    } else if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Removes string and byte literals and a trailing `//` comment so braces and parens can be counted. */
function stripLine(line: string): string {
  let out = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' || (ch === "b" && line[i + 1] === "'" && !/\w/.test(line[i - 1] ?? ""))) {
      const quote = ch === '"' ? '"' : "'";
      let j = i + (ch === '"' ? 1 : 2);
      while (j < line.length && line[j] !== quote) {
        j += line[j] === "\\" ? 2 : 1;
      }
      out += quote === '"' ? '""' : "0";
      i = j;
    } else if (ch === "/" && line[i + 1] === "/") {
      break;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Removes a trailing `//` comment but keeps string contents (module paths are strings). */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

const count = (text: string, ch: string): number => text.split(ch).length - 1;

/** Reads `(...)` starting at the `(` at `open`; returns the inside and the index after `)`. */
function readParens(text: string, open: number): { inside: string; end: number } | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") {
      depth += 1;
    } else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        return { inside: text.slice(open + 1, i), end: i + 1 };
      }
    }
  }
  return undefined;
}

/** Splits at top-level commas (not inside `()`, `[]`, `{}` or `<>`). */
export function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}" || (ch === ">" && text[i - 1] !== "-")) {
      depth -= 1;
    }
    if (ch === "," && depth <= 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseParams(inside: string): ParamDoc[] {
  const out: ParamDoc[] = [];
  for (const part of splitTop(inside)) {
    const colon = part.indexOf(":");
    if (colon === -1) {
      if (/^(?:\.\.)?\w+$/.test(part)) {
        out.push({ name: part, type: "" });
      }
      continue;
    }
    out.push({ name: part.slice(0, colon).trim(), type: part.slice(colon + 1).trim() });
  }
  return out;
}

/** `*T` -> `T`, `[T; N]` -> `T`, `[]mut T` -> `T`, `Vec<i32>` -> `Vec`, `a.B` -> `B`. */
export function memberTypeName(type: string): string {
  let t = type.trim();
  for (;;) {
    if (t.startsWith("*")) {
      t = t.slice(1).trim();
      continue;
    }
    const slice = /^\[\]\s*(?:mut\s+)?(.+)$/.exec(t);
    if (slice) {
      t = slice[1];
      continue;
    }
    const arr = /^\[\s*(.+?)\s*;\s*[^\]]+\]$/.exec(t);
    if (arr) {
      t = arr[1];
      continue;
    }
    break;
  }
  return t.replace(/<.*$/, "").replace(/^.*[./]/, "");
}

/** The element type a `for x in s` walks: `[T; N]` and `[]T` give `T`, `str` gives `u8`. */
function elementType(type: string): string {
  const t = type.trim().replace(/^\*/, "");
  if (t === "str") {
    return "u8";
  }
  const slice = /^\[\]\s*(?:mut\s+)?(.+)$/.exec(t);
  if (slice) {
    return slice[1];
  }
  return /^\[\s*(.+?)\s*;\s*[^\]]+\]$/.exec(t)?.[1] ?? "";
}

function formatSignature(name: string, generics: string | undefined, params: ParamDoc[], ret?: string): string {
  const inner = params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(", ");
  const g = generics ? `<${generics}>` : "";
  return ret ? `fn ${name}${g}(${inner}) -> ${ret}` : `fn ${name}${g}(${inner})`;
}

/** Members of an enum body: `A, B = 5` or `Num(i64) Add(*Expr, *Expr) Nil` (commas are optional). */
function parseEnumMembers(body: string): EnumMember[] {
  const out: EnumMember[] = [];
  const re = /(\w+)\s*(?:\(((?:[^()]|\([^()]*\))*)\))?\s*(?:=\s*([^,\s}]+))?/y;
  let pos = 0;
  for (;;) {
    const skip = /^[\s,]*/.exec(body.slice(pos))![0].length;
    pos += skip;
    if (pos >= body.length) {
      break;
    }
    re.lastIndex = pos;
    const m = re.exec(body);
    if (!m) {
      break;
    }
    out.push({ name: m[1], payload: m[2] !== undefined ? splitTop(m[2]) : undefined, value: m[3] });
    pos = re.lastIndex;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Parsing

interface ModuleCtx {
  moduleId: string;
  filePath: string;
}

interface Container {
  kind: "struct" | "class" | "interface" | "enum" | "impl";
  name: string;
  depth: number;
  aggregate?: AggregateDoc;
}

function makeSymbol(
  init: Partial<SymbolDoc> & Pick<SymbolDoc, "name" | "kind">,
  ctx: ModuleCtx,
  line: number,
  doc: string[]
): SymbolDoc {
  return {
    signature: init.name,
    detail: init.kind,
    documentation: doc.join("\n"),
    exported: false,
    moduleId: ctx.moduleId,
    filePath: ctx.filePath,
    line,
    ...init,
  };
}

function fieldSymbol(owner: string, name: string, type: string, ctx: ModuleCtx, line: number, doc: string[]): SymbolDoc {
  return makeSymbol(
    { name, kind: "field", signature: `${name}: ${type}`, detail: type, owner, exported: true },
    ctx,
    line,
    doc
  );
}

/** Members of a declaration whose body sits on the declaration line: `struct P { x: i32, y: i32 }`. */
function parseInlineBody(agg: AggregateDoc, line: string, ctx: ModuleCtx, lineNo: number, symbols: SymbolDoc[]): void {
  const open = line.indexOf("{");
  const close = line.lastIndexOf("}");
  if (open === -1 || close <= open) {
    return;
  }
  const inner = line.slice(open + 1, close);

  if (agg.kind === "enum") {
    agg.members.push(...parseEnumMembers(inner));
  } else if (agg.kind === "interface") {
    const re = /fn\s+(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner))) {
      const group = readParens(inner, m.index + m[0].length - 1);
      if (!group) {
        continue;
      }
      const params = parseParams(group.inside);
      const ret = /^\s*->\s*([^}]+?)\s*(?:fn\b|$)/.exec(inner.slice(group.end));
      const returnType = ret ? ret[1].trim() : undefined;
      const sym = makeSymbol(
        {
          name: m[1],
          kind: "method",
          signature: formatSignature(m[1], undefined, params, returnType),
          detail: returnType ? `-> ${returnType}` : "fn",
          owner: agg.name,
          returnType,
          exported: true,
        },
        ctx,
        lineNo,
        []
      );
      symbols.push(sym);
      agg.methods.push(sym);
    }
  } else {
    for (const part of splitTop(inner)) {
      const field = /^(\w+)\s*:\s*(.+)$/.exec(part);
      if (field) {
        agg.fields.push({ name: field[1], type: field[2].trim(), line: lineNo });
        symbols.push(fieldSymbol(agg.name, field[1], field[2].trim(), ctx, lineNo, []));
      }
    }
  }
}

export function parseXlangSource(source: string, filePath: string, moduleId: string): ParsedModule {
  const ctx: ModuleCtx = { moduleId, filePath };
  const symbols: SymbolDoc[] = [];
  const aggregates = new Map<string, AggregateDoc>();
  const imports: ImportBinding[] = [];
  const reexports: ReExport[] = [];
  const functions: FunctionScope[] = [];

  const lines = blankBlockComments(source).split("\n");
  let depth = 0;
  let docs: string[] = [];
  let container: Container | undefined;
  let current: FunctionScope | undefined;
  let currentDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed.startsWith("///")) {
      docs.push(trimmed.replace(/^\/\/\/ ?/, ""));
      continue;
    }
    if (trimmed.startsWith("//") || trimmed === "") {
      if (trimmed === "") {
        docs = [];
      }
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }
    if (/^@\w+(\([^)]*\))?\s*$/.test(trimmed)) {
      continue; // attribute line: keeps the doc comment for the declaration below
    }

    // Join a signature that continues on the next lines.
    let line = stripLine(raw);
    let consumed = 0;
    while (
      /\bfn\s+\w+\s*(?:<[^<>]*>)?\s*\(/.test(line) &&
      count(line, "(") > count(line, ")") &&
      i + consumed + 1 < lines.length &&
      consumed < 24
    ) {
      consumed += 1;
      line += " " + stripLine(lines[i + consumed]).trim();
    }

    const depthBefore = depth;
    const opens = count(line, "{");
    const closes = count(line, "}");

    // --- imports / re-exports (module level; they contain strings, so match the raw line)
    if (depthBefore === 0) {
      const code = stripComment(raw);
      let m: RegExpExecArray | null;
      if ((m = IMPORT_STAR_AS_RE.exec(code))) {
        imports.push({ alias: m[1], modulePath: m[2], kind: "namespace" });
      } else if ((m = IMPORT_STAR_RE.exec(code))) {
        imports.push({ alias: "*", modulePath: m[1], kind: "star" });
      } else if ((m = IMPORT_FROM_RE.exec(code))) {
        pushNames(imports, m[1], m[2]);
      } else if ((m = IMPORT_NAMES_RE.exec(code))) {
        pushNames(imports, m[2], m[1]);
      } else if ((m = IMPORT_MODULE_RE.exec(code))) {
        imports.push({ alias: m[2] ?? m[1].split("/").pop() ?? m[1], modulePath: m[1], kind: "namespace" });
      } else if ((m = EXPORT_STAR_AS_RE.exec(code))) {
        reexports.push({ modulePath: m[2], kind: "namespace", alias: m[1] });
      } else if ((m = EXPORT_STAR_RE.exec(code))) {
        reexports.push({
          modulePath: m[1],
          kind: "star",
          except: m[2] ? m[2].split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        });
      } else if ((m = EXPORT_NAMES_RE.exec(code))) {
        reexports.push({
          modulePath: m[2],
          kind: "names",
          names: m[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const [name, alias] = s.split(/\s+as\s+/);
              return { name, alias: alias ?? name };
            }),
        });
      }
    }

    // --- declarations
    let handled = false;
    let m: RegExpExecArray | null;

    if (depthBefore === 0) {
      if ((m = ENUM_RE.exec(line)) && /\benum\b/.test(line)) {
        const exported = Boolean(m[1]);
        const name = m[4];
        const agg: AggregateDoc = {
          name,
          kind: "enum",
          generics: m[5],
          fields: [],
          methods: [],
          members: [],
          exported,
          filePath,
          line: i,
        };
        aggregates.set(name, agg);
        symbols.push(
          makeSymbol(
            {
              name,
              kind: "enum",
              signature: `enum ${name}${m[5] ? `<${m[5]}>` : ""}${m[6] ? `: ${m[6].trim()}` : ""}`,
              detail: "enum",
              exported,
            },
            ctx,
            i,
            docs
          )
        );
        container = { kind: "enum", name, depth: 0, aggregate: agg };
        parseInlineBody(agg, line, ctx, i, symbols);
        handled = true;
      } else if ((m = STRUCT_RE.exec(line))) {
        const exported = Boolean(m[1]);
        const kind = m[4] as "struct" | "class" | "interface";
        const name = m[5];
        const agg: AggregateDoc = {
          name,
          kind,
          generics: m[6],
          base: m[7],
          fields: [],
          methods: [],
          members: [],
          exported,
          filePath,
          line: i,
        };
        aggregates.set(name, agg);
        symbols.push(
          makeSymbol(
            {
              name,
              kind,
              signature: `${kind} ${name}${m[6] ? `<${m[6]}>` : ""}${m[7] ? ` : ${m[7]}` : ""}`,
              detail: kind,
              exported,
            },
            ctx,
            i,
            docs
          )
        );
        container = { kind, name, depth: 0, aggregate: agg };
        parseInlineBody(agg, line, ctx, i, symbols);
        handled = true;
      } else if ((m = IMPL_RE.exec(line))) {
        container = { kind: "impl", name: m[1], depth: 0 };
        handled = true;
      } else if ((m = TYPE_RE.exec(line))) {
        symbols.push(
          makeSymbol(
            {
              name: m[4],
              kind: "type",
              signature: `type ${m[4]}${m[5] ? `<${m[5]}>` : ""} = ${m[6]}`,
              detail: "type alias",
              exported: Boolean(m[1]),
              returnType: m[6],
            },
            ctx,
            i,
            docs
          )
        );
        handled = true;
      } else if ((m = DEFINE_RE.exec(line)) && /\bdefine\b/.test(line)) {
        const isMacro = m[6] !== undefined && m[7] === undefined;
        symbols.push(
          makeSymbol(
            {
              name: m[4],
              kind: "define",
              signature: isMacro ? `define ${m[4]}(${m[6]})` : `define ${m[4]}${m[7] ? ` = ${m[7]}` : ""}`,
              detail: isMacro ? "macro" : "constant",
              exported: Boolean(m[1]),
            },
            ctx,
            i,
            docs
          )
        );
        handled = true;
      } else if ((m = CONST_RE.exec(line)) && /\bconst\b/.test(line)) {
        const type = (m[5] ?? inferLiteralType(m[6])).trim();
        symbols.push(
          makeSymbol(
            {
              name: m[4],
              kind: "const",
              signature: `const ${m[4]}${type ? `: ${type}` : ""} = ${m[6]}`,
              detail: type || "const",
              returnType: type,
              exported: Boolean(m[1]),
            },
            ctx,
            i,
            docs
          )
        );
        handled = true;
      } else if ((m = GLOBAL_RE.exec(line)) && /\bglobal\b/.test(line)) {
        symbols.push(
          makeSymbol(
            {
              name: m[4],
              kind: "global",
              signature: `global ${m[4]}${m[5] ? `: ${m[5]}` : ""}`,
              detail: m[5] ? m[5] : "global",
              returnType: m[5],
              exported: Boolean(m[1]),
            },
            ctx,
            i,
            docs
          )
        );
        handled = true;
      } else if ((m = FN_ALIAS_RE.exec(line))) {
        symbols.push(
          makeSymbol(
            {
              name: m[4],
              kind: "function",
              signature: `fn ${m[4]} = ${m[5]}`,
              detail: "function alias",
              exported: Boolean(m[1]),
            },
            ctx,
            i,
            docs
          )
        );
        handled = true;
      }
    }

    if (!handled) {
      const fn = FN_RE.exec(line);
      if (fn && (depthBefore === 0 || (container && depthBefore === container.depth + 1))) {
        const name = fn[4];
        const open = line.indexOf("(", fn[0].length - 1);
        const group = open === -1 ? undefined : readParens(line, open);
        const params = group ? parseParams(group.inside) : [];
        const after = group ? line.slice(group.end) : "";
        const retMatch = /^\s*->\s*([^{]+?)\s*(?:\{.*)?$/.exec(after);
        const returnType = retMatch ? retMatch[1].trim() : undefined;
        const exported = Boolean(fn[1]);
        const owner = container && depthBefore === container.depth + 1 ? container.name : undefined;
        const sym = makeSymbol(
          {
            name,
            kind: owner ? "method" : "function",
            signature: formatSignature(name, fn[5], params, returnType),
            detail: returnType ? `-> ${returnType}` : "fn",
            exported: owner ? true : exported,
            owner,
            returnType,
          },
          ctx,
          i,
          docs
        );
        symbols.push(sym);
        if (owner) {
          aggregates.get(owner)?.methods.push(sym);
        }
        if (line.includes("{")) {
          current = { name, owner, startLine: i, endLine: i, params: params.map((p) => ({ ...p })), locals: [] };
          currentDepth = depthBefore;
          functions.push(current);
        }
        handled = true;
      }
    }

    // --- fields and enum members of the container
    if (!handled && container && depthBefore === container.depth + 1) {
      if (container.kind === "struct" || container.kind === "class") {
        const field = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(\w+)\s*:\s*([^,]+?)\s*,?\s*$/.exec(line);
        if (field && container.aggregate) {
          container.aggregate.fields.push({ name: field[1], type: field[2], line: i });
          symbols.push(fieldSymbol(container.name, field[1], field[2], ctx, i, docs));
        }
      } else if (container.kind === "enum" && container.aggregate && !/^\s*[{}]/.test(line)) {
        container.aggregate.members.push(...parseEnumMembers(line));
      }
    }

    // --- locals (inside a function body)
    if (current) {
      // The raw text (comment removed): inference reads string and byte literals.
      collectLocals(stripComment(raw), i, current, symbols, aggregates);
    }

    depth = Math.max(0, depth + opens - closes);
    // A function body ends when the brace depth returns to the depth of its declaration.
    if (current && closes > 0 && depth <= currentDepth) {
      current.endLine = i + consumed;
      current = undefined;
    }
    // Same for the struct / class / interface / enum / impl block.
    if (container && closes > 0 && depth <= container.depth) {
      container = undefined;
    }
    docs = [];
    i += consumed;
  }

  // An unterminated function runs to the end of the file.
  if (current) {
    current.endLine = lines.length - 1;
  }

  // A call to a function declared further down could not be typed on the first pass.
  for (const scope of functions) {
    for (const local of scope.locals) {
      if (!local.type && local.init) {
        local.type = inferType(local.init, symbols, aggregates, scope);
      }
    }
  }

  return { moduleId, filePath, symbols, aggregates, imports, reexports, functions };
}

function collectLocals(
  line: string,
  lineNo: number,
  scope: FunctionScope,
  symbols: SymbolDoc[],
  aggregates: Map<string, AggregateDoc>
): void {
  const infer = (rhs: string) => inferType(rhs, symbols, aggregates, scope);
  const add = (name: string, type: string, init?: string) =>
    scope.locals.push({ name, type: type.trim(), line: lineNo, init: type ? undefined : init });
  let m: RegExpExecArray | null;

  if ((m = TUPLE_LOCAL_RE.exec(line))) {
    const names = m[1].split(",").map((s) => s.trim());
    const tuple = infer(m[2]);
    const elems = tuple.startsWith("(") ? splitTop(tuple.slice(1, -1)) : [];
    names.forEach((n, idx) => n && n !== "_" && add(n, elems[idx] ?? ""));
    return;
  }
  if ((m = LOCAL_RE.exec(line))) {
    add(m[1], m[2] ?? infer(m[3] ?? ""), m[3]);
  } else if ((m = FOR_LOCAL_RE.exec(line))) {
    add(m[1], m[2] ?? infer(m[3]), m[3]);
  } else if ((m = FOR_RANGE_RE.exec(line))) {
    add(m[1], infer(m[2]), m[2]);
  } else if ((m = FOR_EACH_RE.exec(line)) && !m[3].includes("..")) {
    const element = elementType(infer(m[3]));
    add(m[1], element ? `*${element}` : "");
    if (m[2]) {
      add(m[2], "usize");
    }
  }
  if ((m = CATCH_RE.exec(line))) {
    add(m[1], "*u8");
  }
  if ((m = CASE_PAYLOAD_RE.exec(line))) {
    const member = aggregates.get(memberTypeName(m[1]))?.members.find((e) => e.name === m![2]);
    splitTop(m[3]).forEach((n, idx) => n !== "_" && /^\w+$/.test(n) && add(n, member?.payload?.[idx] ?? ""));
  }
}

function pushNames(out: ImportBinding[], modulePath: string, list: string): void {
  for (const part of list.split(",")) {
    const spec = part.trim();
    if (!spec) {
      continue;
    }
    const [name, alias] = spec.split(/\s+as\s+/).map((s) => s.trim());
    if (name) {
      out.push({ alias: alias ?? name, modulePath, kind: "symbol", symbolName: name });
    }
  }
}

/** The default type of a literal: integers `i32`, floats `f64`, `bool`, strings `str`, bytes `u8`. */
function inferLiteralType(text: string): string {
  const t = text.trim();
  if (/^".*"$/.test(t)) {
    return "str";
  }
  if (/^b'(?:\\.|[^'])+'$/.test(t)) {
    return "u8";
  }
  if (/^(true|false)$/.test(t)) {
    return "bool";
  }
  if (/^-?\d+\.\d+(?:[eE][+-]?\d+)?$/.test(t)) {
    return "f64";
  }
  if (/^-?(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*)$/.test(t)) {
    return "i32";
  }
  return "";
}

function inferType(
  rhs: string,
  symbols: SymbolDoc[],
  aggregates: Map<string, AggregateDoc>,
  scope: FunctionScope
): string {
  const text = rhs.trim();
  let m: RegExpExecArray | null;
  if ((m = /^new(?:\([^)]*\))?\s+([\w.]+(?:<[^<>]*>)?)/.exec(text))) {
    return `*${m[1]}`;
  }
  if ((m = /^([A-Z]\w*)(?:<[^<>]*>)?\s*[({]/.exec(text)) && aggregates.has(m[1])) {
    return m[1];
  }
  if ((m = /\bas\s+([^\s]+)\s*$/.exec(text))) {
    return m[1];
  }
  const named = (n: string) => scope.locals.find((l) => l.name === n) ?? scope.params.find((p) => p.name === n);
  if ((m = /^&\s*(\w+)\s*$/.exec(text))) {
    const base = named(m[1]);
    return base?.type ? `*${base.type}` : "";
  }
  // `T(args)` builds a class and `T { f: v }` a struct, also when `T` comes from another module: the
  // naming convention (types are PascalCase) is the only hint the line gives.
  if ((m = /^([A-Z]\w*)(?:<[^<>]*>)?\s*(?:\(|\{\s*(?:\w+\s*:|\}))/.exec(text)) && !symbols.some((s) => s.name === m![1] && s.kind === "function")) {
    return /^[A-Z]\w*(?:<[^<>]*>)?/.exec(text)![0];
  }
  if ((m = /^(\w+)(?:<[^<>]*>)?\s*\(/.exec(text))) {
    const fn = symbols.find((s) => s.name === m![1] && (s.kind === "function" || s.kind === "method"));
    return fn?.returnType ?? "";
  }
  return inferLiteralType(text) || (named(text)?.type ?? "");
}

/**
 * The module key of a file: `std/...` below the stdlib root, `<repository path>/...` below a package
 * root, otherwise relative to the project (or workspace) folder; the bare file name as a last resort.
 * `roots` lists the `-M NAME=DIR` pairs.
 */
export function moduleIdFromPath(
  filePath: string,
  roots: { name: string; dir: string }[],
  baseDir?: string
): string {
  const normalized = path.normalize(filePath);
  const stem = (rel: string) => rel.slice(0, -".xl".length).replace(/\\/g, "/").replace(/(^|\/)index$/, "");
  for (const root of roots) {
    const rel = path.relative(root.dir, normalized);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      const inner = stem(rel);
      return inner ? `${root.name}/${inner}` : root.name;
    }
  }
  if (baseDir) {
    const rel = path.relative(baseDir, normalized);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      return stem(rel) || path.basename(normalized, ".xl");
    }
  }
  return path.basename(normalized, ".xl");
}
