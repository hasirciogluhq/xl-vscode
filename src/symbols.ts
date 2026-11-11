import * as path from "node:path";
import * as vscode from "vscode";
import { SOURCE_EXT } from "./paths";

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

export interface AggregateDoc {
  name: string;
  kind: "struct" | "class" | "interface" | "enum";
  base?: string;
  fields: FieldDoc[];
  methods: SymbolDoc[];
  members: string[];
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
// Parsing (line based; the compiler is the authority, this only feeds IntelliSense)

const MODS = String.raw`(?:(export)(?:\((\w+)\))?\s+)?(?:(declare)\s+)?(?:register(?:\(\w+\))?\s+)?`;
const FN_RE = new RegExp(String.raw`^\s*(?:@\w+(?:\([^)]*\))?\s+)*${MODS}(?:(?:virtual|override)\s+)*fn\s+(\w+)\s*\(`);
const STRUCT_RE = new RegExp(String.raw`^\s*(?:@\w+(?:\([^)]*\))?\s+)*${MODS}(struct|class|interface)\s+(\w+)(?:\s*:\s*([\w./]+))?`);
const ENUM_RE = new RegExp(String.raw`^\s*(?:@\w+(?:\([^)]*\))?\s+)*${MODS}enum\s+(\w+)(?:\s*:\s*([^{]+?))?\s*\{?`);
const IMPL_RE = /^\s*impl\s+([\w./]+)\s+for\s+(\w+)/;
const TYPE_RE = new RegExp(String.raw`^\s*${MODS}type\s+(\w+)\s*=\s*(.+?)\s*$`);
const DEFINE_RE = new RegExp(String.raw`^\s*${MODS}define\s+(\w+)\s*(\(([^)]*)\))?\s*(?:=\s*(.+?))?\s*\{?\s*$`);
const GLOBAL_RE = new RegExp(String.raw`^\s*(?:@\w+(?:\([^)]*\))?\s+)*${MODS}global\s+(\w+)\s*(?::\s*([^=]+?))?\s*(?:=.*)?$`);
const LOCAL_RE = /^\s*local\s+(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+?))?\s*$/;
const FOR_LOCAL_RE = /\bfor\s+local\s+(\w+)\s*(?::\s*([^=;]+?))?\s*=\s*([^;]+)/;
const FOR_RANGE_RE = /\bfor\s+(\w+)\s+in\s+([^.]+?)\s*\.\./;

const IMPORT_FROM_RE = /^\s*from\s+"([^"]+)"\s+import\s+(.+?)\s*$/;
const IMPORT_NAMES_RE = /^\s*import\s+(?!\*)(\w[\w\s,]*?)\s+from\s+"([^"]+)"\s*$/;
const IMPORT_STAR_RE = /^\s*import\s+\*\s+from\s+"([^"]+)"\s*$/;
const IMPORT_STAR_AS_RE = /^\s*import\s+\*\s+as\s+(\w+)\s+from\s+"([^"]+)"\s*$/;
const IMPORT_MODULE_RE = /^\s*import\s+"([^"]+)"(?:\s+as\s+(\w+))?\s*$/;
const EXPORT_STAR_RE = /^\s*export\s+\*\s+from\s+"([^"]+)"(?:\s+except\s+(.+?))?\s*$/;
const EXPORT_STAR_AS_RE = /^\s*export\s+\*\s+as\s+(\w+)\s+from\s+"([^"]+)"\s*$/;
const EXPORT_NAMES_RE = /^\s*export\s+\{([^}]*)\}\s+from\s+"([^"]+)"\s*$/;

/** Removes strings and a trailing `//` comment so braces and parentheses can be counted. */
function stripLine(line: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        out += '"';
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += '"';
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") {
      break;
    }
    out += ch;
  }
  return out;
}

/** Removes a trailing `//` comment but keeps string contents (module paths are strings). */
function stripComment(line: string): string {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

function count(text: string, ch: string): number {
  let n = 0;
  for (const c of text) {
    if (c === ch) {
      n += 1;
    }
  }
  return n;
}

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

function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
    }
    if (ch === "," && depth === 0) {
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
      if (/^\w+$/.test(part)) {
        out.push({ name: part, type: "" });
      }
      continue;
    }
    out.push({ name: part.slice(0, colon).trim(), type: part.slice(colon + 1).trim() });
  }
  return out;
}

/** `*T` -> `T`, `[T; N]` -> `T`: the type whose members a value of this type exposes. */
export function memberTypeName(type: string): string {
  let t = type.trim();
  for (;;) {
    if (t.startsWith("*")) {
      t = t.slice(1).trim();
      continue;
    }
    const arr = /^\[\s*(.+?)\s*;\s*[^\]]+\]$/.exec(t);
    if (arr) {
      t = arr[1];
      continue;
    }
    break;
  }
  return t.replace(/^.*\//, "");
}

function formatSignature(name: string, params: ParamDoc[], ret?: string): string {
  const inner = params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(", ");
  return ret ? `fn ${name}(${inner}) -> ${ret}` : `fn ${name}(${inner})`;
}

function makeSymbol(init: Partial<SymbolDoc> & Pick<SymbolDoc, "name" | "kind">, ctx: ModuleCtx, line: number, doc: string[]): SymbolDoc {
  const text = doc.join("\n");
  return {
    signature: init.name,
    detail: init.kind,
    documentation: text,
    exported: false,
    moduleId: ctx.moduleId,
    filePath: ctx.filePath,
    line,
    ...init,
  };
}

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

/** Members of a declaration whose body sits on the declaration line: `struct P { x: i32, y: i32 }`. */
function parseInlineBody(
  agg: AggregateDoc,
  line: string,
  ctx: ModuleCtx,
  lineNo: number,
  symbols: SymbolDoc[]
): void {
  const open = line.indexOf("{");
  const close = line.lastIndexOf("}");
  if (open === -1 || close <= open) {
    return;
  }
  const inner = line.slice(open + 1, close);

  if (agg.kind === "enum") {
    for (const part of splitTop(inner)) {
      const member = /^(\w+)\s*(?:=.*)?$/.exec(part);
      if (member) {
        agg.members.push(member[1]);
      }
    }
    return;
  }

  if (agg.kind === "interface") {
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
          signature: formatSignature(m[1], params, returnType),
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
    return;
  }

  for (const part of splitTop(inner)) {
    const field = /^(\w+)\s*:\s*(.+)$/.exec(part);
    if (field) {
      agg.fields.push({ name: field[1], type: field[2].trim(), line: lineNo });
      symbols.push(
        makeSymbol(
          {
            name: field[1],
            kind: "field",
            signature: `${field[1]}: ${field[2].trim()}`,
            detail: field[2].trim(),
            owner: agg.name,
            exported: true,
          },
          ctx,
          lineNo,
          []
        )
      );
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

  const lines = source.split("\n");
  let depth = 0;
  let docs: string[] = [];
  let container: Container | undefined;
  let current: FunctionScope | undefined;
  let currentDepth = 0;

  const aggregate = (name: string): AggregateDoc | undefined => aggregates.get(name);

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
    while (/\bfn\s+\w+\s*\(/.test(line) && count(line, "(") > count(line, ")") && i + consumed + 1 < lines.length && consumed < 24) {
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
        imports.push({
          alias: m[2] ?? m[1].split("/").pop() ?? m[1],
          modulePath: m[1],
          kind: "namespace",
        });
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
            { name, kind: "enum", signature: `enum ${name}${m[5] ? `: ${m[5].trim()}` : ""}`, detail: "enum", exported },
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
          base: m[6],
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
              signature: `${kind} ${name}${m[6] ? ` : ${m[6]}` : ""}`,
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
        container = { kind: "impl", name: m[2], depth: 0 };
        handled = true;
      } else if ((m = TYPE_RE.exec(line))) {
        symbols.push(
          makeSymbol(
            { name: m[4], kind: "type", signature: `type ${m[4]} = ${m[5]}`, detail: "type alias", exported: Boolean(m[1]) },
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
        const retMatch = /^\s*->\s*([^{]+?)\s*\{?\s*$/.exec(after);
        const returnType = retMatch ? retMatch[1].trim() : undefined;
        const exported = Boolean(fn[1]);
        const owner = container && depthBefore === container.depth + 1 ? container.name : undefined;
        const sym = makeSymbol(
          {
            name,
            kind: owner ? "method" : "function",
            signature: formatSignature(name, params, returnType),
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
          aggregate(owner)?.methods.push(sym);
        }
        const hasBody = line.includes("{");
        if (hasBody) {
          current = {
            name,
            owner,
            startLine: i,
            endLine: i,
            params: params.map((p) => ({ ...p })),
            locals: [],
          };
          currentDepth = depthBefore;
          functions.push(current);
        }
        handled = true;
      }
    }

    if (!handled && container && depthBefore === container.depth + 1) {
      if (container.kind === "struct" || container.kind === "class") {
        const field = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(\w+)\s*:\s*([^,]+?)\s*,?\s*$/.exec(line);
        if (field && container.aggregate) {
          container.aggregate.fields.push({ name: field[1], type: field[2], line: i });
          symbols.push(
            makeSymbol(
              {
                name: field[1],
                kind: "field",
                signature: `${field[1]}: ${field[2]}`,
                detail: field[2],
                owner: container.name,
                exported: true,
              },
              ctx,
              i,
              docs
            )
          );
        }
      } else if (container.kind === "enum" && container.aggregate) {
        for (const part of line.split(",")) {
          const member = /^\s*(\w+)\s*(?:=.*)?$/.exec(part);
          if (member && !/^\s*[{}]/.test(part)) {
            container.aggregate.members.push(member[1]);
          }
        }
      }
    }

    // --- locals (inside a function body)
    if (current) {
      let lm: RegExpExecArray | null;
      if ((lm = LOCAL_RE.exec(line))) {
        current.locals.push({
          name: lm[1],
          type: (lm[2] ?? inferType(lm[3] ?? "", symbols, aggregates, current)).trim(),
          line: i,
        });
      } else if ((lm = FOR_LOCAL_RE.exec(line))) {
        current.locals.push({
          name: lm[1],
          type: (lm[2] ?? inferType(lm[3], symbols, aggregates, current)).trim(),
          line: i,
        });
      } else if ((lm = FOR_RANGE_RE.exec(line))) {
        current.locals.push({ name: lm[1], type: inferType(lm[2], symbols, aggregates, current), line: i });
      }
    }

    depth += opens - closes;
    if (depth < 0) {
      depth = 0;
    }
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

  return { moduleId, filePath, symbols, aggregates, imports, reexports, functions };
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

function inferType(
  rhs: string,
  symbols: SymbolDoc[],
  aggregates: Map<string, AggregateDoc>,
  scope: FunctionScope
): string {
  const text = rhs.trim();
  let m: RegExpExecArray | null;
  if ((m = /^new(?:\([^)]*\))?\s+([\w.]+)/.exec(text))) {
    return `*${m[1]}`;
  }
  if ((m = /^([A-Z]\w*)\s*\{/.exec(text)) && aggregates.has(m[1])) {
    return m[1];
  }
  if ((m = /\bas\s+([^\s]+)\s*$/.exec(text))) {
    return m[1];
  }
  if ((m = /^&\s*(\w+)\s*$/.exec(text))) {
    const base = scope.locals.find((l) => l.name === m![1]) ?? scope.params.find((p) => p.name === m![1]);
    return base?.type ? `*${base.type}` : "";
  }
  if ((m = /^(\w+)\s*\(/.exec(text))) {
    const fn = symbols.find((s) => s.name === m![1] && (s.kind === "function" || s.kind === "method"));
    return fn?.returnType ?? "";
  }
  if (/^".*"$/.test(text)) {
    return "*ui8";
  }
  if (/^(true|false)$/.test(text)) {
    return "bool";
  }
  if (/^-?\d+$/.test(text)) {
    return "i32";
  }
  if (/^-?\d+\.\d+$/.test(text)) {
    return "f64";
  }
  const named = scope.locals.find((l) => l.name === text) ?? scope.params.find((p) => p.name === text);
  return named?.type ?? "";
}

export function moduleIdFromPath(filePath: string, stdRoot?: string, workspaceRoot?: string): string {
  const normalized = path.normalize(filePath);
  if (stdRoot) {
    const rel = path.relative(stdRoot, normalized);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      const stem = rel.slice(0, -SOURCE_EXT.length).replace(/\\/g, "/");
      return stem === "index" ? "std" : `std/${stem.replace(/\/index$/, "")}`;
    }
  }
  if (workspaceRoot) {
    const rel = path.relative(workspaceRoot, normalized);
    if (!rel.startsWith("..")) {
      return rel.slice(0, -SOURCE_EXT.length).replace(/\\/g, "/");
    }
  }
  return path.basename(normalized, SOURCE_EXT);
}

// ---------------------------------------------------------------------------------------------
// VS Code presentation

export function symbolToHover(sym: SymbolDoc): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendCodeblock(sym.signature, "xlang");
  if (sym.documentation) {
    md.appendMarkdown(`\n${sym.documentation}\n`);
  }
  const where = [sym.owner ? `member of \`${sym.owner}\`` : "", sym.moduleId ? `module \`${sym.moduleId}\`` : ""]
    .filter(Boolean)
    .join(" · ");
  if (where) {
    md.appendMarkdown(`\n---\n*${where}*`);
  }
  return md;
}

export function symbolToCompletion(sym: SymbolDoc, sortPrefix: string): vscode.CompletionItem {
  const K = vscode.CompletionItemKind;
  const kind =
    sym.kind === "struct"
      ? K.Struct
      : sym.kind === "class"
        ? K.Class
        : sym.kind === "interface"
          ? K.Interface
          : sym.kind === "enum"
            ? K.Enum
            : sym.kind === "enumMember"
              ? K.EnumMember
              : sym.kind === "field"
                ? K.Field
                : sym.kind === "method"
                  ? K.Method
                  : sym.kind === "type"
                    ? K.TypeParameter
                    : sym.kind === "define"
                      ? K.Constant
                      : sym.kind === "global" || sym.kind === "variable"
                        ? K.Variable
                        : sym.kind === "module"
                          ? K.Module
                          : K.Function;
  const item = new vscode.CompletionItem(sym.name, kind);
  item.detail = sym.signature;
  item.documentation = symbolToHover(sym);
  item.sortText = `${sortPrefix}_${sym.name}`;
  if (sym.kind === "function" || sym.kind === "method") {
    item.insertText = new vscode.SnippetString(`${sym.name}($0)`);
  } else if (sym.kind === "define" && sym.detail === "macro") {
    item.insertText = new vscode.SnippetString(`${sym.name}!($0)`);
  }
  return item;
}
