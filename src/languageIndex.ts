import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  type AggregateDoc,
  type FunctionScope,
  type ParsedModule,
  type SymbolDoc,
  memberTypeName,
  moduleIdFromPath,
  parseXlangSource,
} from "./parser";
import { type ModuleContext, moduleContext, resolveModuleFile } from "./paths";

const MAX_REEXPORT_DEPTH = 6;

const VALUE_KINDS = new Set(["global", "const"]);

export class LanguageIndex {
  private readonly moduleCache = new Map<string, ParsedModule>();
  private readonly fileCache = new Map<string, ParsedModule>();
  private readonly contexts = new Map<string, ModuleContext>();
  private compilerPath: string | undefined;

  setCompilerPath(compilerPath: string | undefined): void {
    this.compilerPath = compilerPath;
    this.contexts.clear();
  }

  invalidate(uri?: vscode.Uri): void {
    if (uri) {
      this.fileCache.delete(uri.fsPath);
    }
    this.moduleCache.clear();
    this.contexts.clear();
  }

  /** Module roots (packages and the stdlib) that apply to a file: what `-M` would carry. */
  context(contextFile: string): ModuleContext {
    const key = path.dirname(contextFile);
    let ctx = this.contexts.get(key);
    if (!ctx) {
      ctx = moduleContext(contextFile, this.compilerPath);
      this.contexts.set(key, ctx);
    }
    return ctx;
  }

  getDocumentModule(document: vscode.TextDocument): ParsedModule {
    const key = document.uri.fsPath;
    const cached = this.fileCache.get(key);
    if (cached) {
      return cached;
    }
    const ctx = this.context(key);
    const parsed = parseXlangSource(
      document.getText(),
      key,
      moduleIdFromPath(key, ctx.roots, ctx.projectDir ?? vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath)
    );
    this.fileCache.set(key, parsed);
    return parsed;
  }

  getModule(modulePath: string, contextFile: string): ParsedModule | undefined {
    const file = resolveModuleFile(modulePath, contextFile, this.context(contextFile));
    if (!file) {
      return undefined;
    }
    const hit = this.moduleCache.get(file);
    if (hit) {
      return hit;
    }
    let source: string;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
    const ctx = this.context(file);
    const parsed = parseXlangSource(source, file, moduleIdFromPath(file, ctx.roots, ctx.projectDir));
    this.moduleCache.set(file, parsed);
    return parsed;
  }

  /** Everything `mod` exports, following `export * from` and `export { } from` chains. */
  exportedSymbols(mod: ParsedModule, depth = 0, seen = new Set<string>()): SymbolDoc[] {
    if (depth > MAX_REEXPORT_DEPTH || seen.has(mod.filePath)) {
      return [];
    }
    seen.add(mod.filePath);

    const out: SymbolDoc[] = mod.symbols.filter((s) => s.exported && !s.owner);
    for (const re of mod.reexports) {
      const target = this.getModule(re.modulePath, mod.filePath);
      if (!target) {
        continue;
      }
      if (re.kind === "namespace" && re.alias) {
        out.push(namespaceSymbol(re.alias, `export * as ${re.alias} from "${re.modulePath}"`, re.modulePath, target.filePath));
        continue;
      }
      const inner = this.exportedSymbols(target, depth + 1, seen);
      if (re.kind === "names" && re.names) {
        for (const n of re.names) {
          const sym = inner.find((s) => s.name === n.name);
          if (sym) {
            out.push({ ...sym, name: n.alias });
          }
        }
      } else {
        const except = new Set(re.except ?? []);
        out.push(...inner.filter((sym) => !except.has(sym.name)));
      }
    }
    return dedupe(out);
  }

  /** Modules whose declarations are reachable from `document` (imports and their re-exports). */
  private reachableModules(document: vscode.TextDocument): ParsedModule[] {
    const out: ParsedModule[] = [];
    const seen = new Set<string>();
    const visit = (mod: ParsedModule | undefined, depth: number) => {
      if (!mod || depth > MAX_REEXPORT_DEPTH || seen.has(mod.filePath)) {
        return;
      }
      seen.add(mod.filePath);
      out.push(mod);
      for (const re of mod.reexports) {
        visit(this.getModule(re.modulePath, mod.filePath), depth + 1);
      }
    };
    const self = this.getDocumentModule(document);
    seen.add(self.filePath);
    for (const imp of self.imports) {
      visit(this.getModule(imp.modulePath, document.uri.fsPath), 0);
    }
    return out;
  }

  /** Names usable without a prefix: own declarations plus what the imports bring in. */
  visibleSymbols(document: vscode.TextDocument): SymbolDoc[] {
    const self = this.getDocumentModule(document);
    const out: SymbolDoc[] = self.symbols.filter((s) => !s.owner);
    const contextFile = document.uri.fsPath;

    for (const imp of self.imports) {
      const mod = this.getModule(imp.modulePath, contextFile);
      if (!mod) {
        continue;
      }
      if (imp.kind === "star") {
        out.push(...this.exportedSymbols(mod));
      } else if (imp.kind === "namespace") {
        out.push(namespaceSymbol(imp.alias, `import "${imp.modulePath}" as ${imp.alias}`, imp.modulePath, mod.filePath));
      } else if (imp.symbolName) {
        const sym = this.exportedSymbols(mod).find((s) => s.name === imp.symbolName);
        if (sym) {
          out.push({ ...sym, name: imp.alias });
        }
      }
    }
    return dedupe(out);
  }

  /** Members of a namespace alias (`import * as a`, `import "m" as a`, `export * as a`). */
  namespaceMembers(document: vscode.TextDocument, alias: string): SymbolDoc[] | undefined {
    const imp = this.getDocumentModule(document).imports.find((i) => i.kind === "namespace" && i.alias === alias);
    if (!imp) {
      return undefined;
    }
    const mod = this.getModule(imp.modulePath, document.uri.fsPath);
    return mod ? this.exportedSymbols(mod) : [];
  }

  scopeAt(document: vscode.TextDocument, line: number): FunctionScope | undefined {
    return this.getDocumentModule(document).functions.find((f) => line >= f.startLine && line <= f.endLine);
  }

  /** Declared type of a name at a line: local (declared above), parameter, `self`, global. */
  typeOfName(document: vscode.TextDocument, name: string, line: number): string | undefined {
    const scope = this.scopeAt(document, line);
    if (scope) {
      if (name === "self") {
        return scope.owner;
      }
      const local = scope.locals.filter((l) => l.name === name && l.line <= line).at(-1);
      if (local?.type) {
        return local.type;
      }
      const param = scope.params.find((p) => p.name === name);
      if (param?.type) {
        return param.type;
      }
    }
    return this.visibleSymbols(document).find((s) => VALUE_KINDS.has(s.kind) && s.name === name)?.returnType;
  }

  findAggregate(document: vscode.TextDocument, typeName: string): AggregateDoc | undefined {
    const name = memberTypeName(typeName);
    const own = this.getDocumentModule(document).aggregates.get(name);
    if (own) {
      return own;
    }
    for (const mod of this.reachableModules(document)) {
      const hit = mod.aggregates.get(name);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  /** Fields, methods (own, inherited, from `impl` blocks) and enum members of a type. */
  membersOfType(document: vscode.TextDocument, typeName: string): SymbolDoc[] {
    const out: SymbolDoc[] = [];
    const visited = new Set<string>();
    const mods = [this.getDocumentModule(document), ...this.reachableModules(document)];

    const collect = (name: string) => {
      if (visited.has(name)) {
        return;
      }
      visited.add(name);
      const agg = this.findAggregate(document, name);
      for (const mod of mods) {
        out.push(...mod.symbols.filter((s) => s.owner === name && (s.kind === "field" || s.kind === "method")));
      }
      if (agg?.kind === "enum") {
        for (const member of agg.members) {
          const payload = member.payload ? `(${member.payload.join(", ")})` : "";
          out.push({
            name: member.name,
            kind: "enumMember",
            signature: `${agg.name}.${member.name}${payload}${member.value ? ` = ${member.value}` : ""}`,
            detail: member.payload ? "payload variant" : "enum member",
            documentation: "",
            exported: true,
            owner: agg.name,
            moduleId: "",
            filePath: agg.filePath,
            line: agg.line,
          });
        }
      }
      if (agg?.base) {
        collect(memberTypeName(agg.base));
      }
    };

    collect(memberTypeName(typeName));
    return dedupe(out);
  }

  /** Completion / hover members for `chain.` such as `a`, `self.b` or `Color`. */
  resolveMemberAccess(document: vscode.TextDocument, chain: string, line: number): SymbolDoc[] {
    const parts = chain.split(".").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) {
      return [];
    }
    if (parts.length === 1) {
      const ns = this.namespaceMembers(document, parts[0]);
      if (ns) {
        return ns;
      }
      const agg = this.findAggregate(document, parts[0]);
      if (agg?.kind === "enum" && !this.typeOfName(document, parts[0], line)) {
        return this.membersOfType(document, agg.name);
      }
    }

    let type: string | undefined = this.typeOfName(document, parts[0], line);
    if (!type) {
      return [];
    }
    for (const part of parts.slice(1)) {
      const field: SymbolDoc | undefined = this.membersOfType(document, type).find((m) => m.name === part);
      type = field?.kind === "field" ? field.detail : field?.returnType;
      if (!type) {
        return [];
      }
    }
    return this.membersOfType(document, type);
  }

  findSymbol(document: vscode.TextDocument, name: string, line: number): SymbolDoc | undefined {
    const scope = this.scopeAt(document, line);
    if (scope) {
      const local = scope.locals.filter((l) => l.name === name && l.line <= line).at(-1);
      const param = scope.params.find((p) => p.name === name);
      const found = local ?? param;
      if (found) {
        const type = found.type || "?";
        return {
          name,
          kind: "variable",
          signature: `${name}: ${type}`,
          detail: type,
          documentation: local ? "Local variable." : "Parameter.",
          exported: false,
          moduleId: this.getDocumentModule(document).moduleId,
          filePath: document.uri.fsPath,
          line: local ? local.line : scope.startLine,
        };
      }
    }
    return this.visibleSymbols(document).find((s) => s.name === name);
  }

  /** Short markdown listing of what a module exports (for the import path completion). */
  moduleDescription(modulePath: string, contextFile: string): string {
    const mod = this.getModule(modulePath, contextFile);
    if (!mod) {
      return `Module \`${modulePath}\``;
    }
    const names = this.exportedSymbols(mod)
      .map((s) => s.name)
      .slice(0, 12);
    return names.length > 0
      ? `Exports: ${names.map((n) => `\`${n}\``).join(", ")}${names.length >= 12 ? ", …" : ""}`
      : `Module \`${modulePath}\``;
  }
}

function namespaceSymbol(alias: string, signature: string, modulePath: string, filePath: string): SymbolDoc {
  return {
    name: alias,
    kind: "module",
    signature,
    detail: "namespace",
    documentation: "",
    exported: true,
    moduleId: modulePath,
    filePath,
    line: 0,
  };
}

function dedupe(list: SymbolDoc[]): SymbolDoc[] {
  const map = new Map<string, SymbolDoc>();
  for (const sym of list) {
    if (!map.has(sym.name)) {
      map.set(sym.name, sym);
    }
  }
  return [...map.values()];
}

let sharedIndex: LanguageIndex | undefined;

export function getLanguageIndex(): LanguageIndex {
  sharedIndex ??= new LanguageIndex();
  return sharedIndex;
}

export function resetLanguageIndex(): void {
  sharedIndex?.invalidate();
  sharedIndex = undefined;
}
