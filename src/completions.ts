import * as vscode from "vscode";
import {
  ATTRIBUTES,
  BUILTINS,
  DIRECTIVES,
  KEYWORDS,
  MEMORY_ORDERS,
  PREDEFINED,
  ROLES,
  TYPES,
  catalogToCompletion,
} from "./builtins";
import { getLanguageIndex } from "./languageIndex";
import { listModulePaths } from "./paths";
import { symbolToCompletion } from "./symbols";

const TRIGGER_CHARS = [".", "@", "#", '"', "/", "<", ...Array.from("abcdefghijklmnopqrstuvwxyz")];

const ORIGIN_DETAIL = { std: "standard library", package: "package", local: "module" } as const;

export function registerCompletions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "xlang",
      {
        provideCompletionItems(document, position) {
          const index = getLanguageIndex();
          const line = document.lineAt(position.line).text;
          const prefix = line.slice(0, position.character);

          // Module path inside `from "..."`, `import "..."`, `import * from "..."`, `export ... from "..."`.
          const modulePrefix = /(?:\bfrom|\bimport)\s+"([^"]*)$/.exec(prefix);
          if (modulePrefix) {
            return moduleCompletions(index, document, position, modulePrefix[1]);
          }

          // `#if os == "li`: the values a predefined name can have.
          const directiveValue = /^\s*#(?:if|elif)\b.*\b(\w+)\s*[=!]=\s*"([^"]*)$/.exec(prefix);
          if (directiveValue) {
            return (PREDEFINED.find((p) => p.name === directiveValue[1])?.values ?? []).map(
              (value) => new vscode.CompletionItem(value, vscode.CompletionItemKind.Value)
            );
          }

          if (isInsideString(prefix) || /\/\/.*$/.test(prefix)) {
            return [];
          }

          // `@attribute`
          if (/@[A-Za-z_]*$/.test(prefix)) {
            return ATTRIBUTES.map((a) => catalogToCompletion(a, "0"));
          }

          // `#if`, `#endif`, ...
          if (/^\s*#[a-z]*$/.test(prefix)) {
            return DIRECTIVES.map((d) => catalogToCompletion(d, "0"));
          }

          // Names an `#if` condition reads: `#if os == ...`, `#ifdef featureX`.
          if (/^\s*#(?:if|elif|ifdef|ifndef)\b[^"]*$/.test(prefix)) {
            return PREDEFINED.map((p) => {
              const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Constant);
              item.detail = "predefined";
              item.documentation = new vscode.MarkdownString(p.documentation);
              return item;
            });
          }

          // `MemoryOrder.seqCst`
          if (/\bMemoryOrder\.\w*$/.test(prefix)) {
            return MEMORY_ORDERS.map((m) => catalogToCompletion(m, "0"));
          }

          // `register(panic)`
          if (/\bregister\(\w*$/.test(prefix)) {
            return ROLES.map((r) => catalogToCompletion(r, "0"));
          }

          // Member access: `a.`, `self.b.`, `Color.`, `ns.`
          const member = /([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\.\s*(\w*)$/.exec(prefix);
          if (member) {
            return index.resolveMemberAccess(document, member[1], position.line).map((sym) => symbolToCompletion(sym, "0"));
          }

          // `: ` / `->` / `as` / `*` / `[` / `<` / `mut`: type position.
          const typePosition = /(?::(?!=)\s*|->\s*|\bas\s+|\*\s*|\[\s*|<\s*|\bmut\s+)\w*$/.test(prefix);

          const items: vscode.CompletionItem[] = [];
          for (const ty of TYPES) {
            items.push(catalogToCompletion(ty, typePosition ? "0" : "2"));
          }
          for (const sym of index.visibleSymbols(document)) {
            const isType = ["struct", "class", "interface", "enum", "type"].includes(sym.kind);
            items.push(symbolToCompletion(sym, isType ? (typePosition ? "0" : "3") : typePosition ? "4" : "1"));
          }
          if (typePosition) {
            return items;
          }

          for (const kw of KEYWORDS) {
            items.push(catalogToCompletion(kw, "2"));
          }
          for (const b of BUILTINS) {
            items.push(catalogToCompletion(b, "3"));
          }

          const scope = index.scopeAt(document, position.line);
          if (scope) {
            const variable = (name: string, type: string) => {
              const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
              item.detail = type ? `${name}: ${type}` : name;
              item.sortText = `0_${name}`;
              return item;
            };
            items.push(...scope.params.map((p) => variable(p.name, p.type)));
            items.push(...scope.locals.filter((l) => l.line <= position.line).map((l) => variable(l.name, l.type)));
          }
          return items;
        },
      },
      ...TRIGGER_CHARS
    )
  );
}

function moduleCompletions(
  index: ReturnType<typeof getLanguageIndex>,
  document: vscode.TextDocument,
  position: vscode.Position,
  typed: string
): vscode.CompletionItem[] {
  const contextFile = document.uri.fsPath;
  // The whole typed path is replaced: the default word range stops at `/` and `.`.
  const range = new vscode.Range(position.line, position.character - typed.length, position.line, position.character);
  return listModulePaths(contextFile, index.context(contextFile)).map(({ path: modulePath, origin }) => {
    const item = new vscode.CompletionItem(modulePath, vscode.CompletionItemKind.Module);
    item.detail = ORIGIN_DETAIL[origin];
    item.documentation = new vscode.MarkdownString(index.moduleDescription(modulePath, contextFile));
    item.sortText = `${origin === "local" ? "0" : origin === "package" ? "1" : "2"}_${modulePath}`;
    item.filterText = modulePath;
    item.range = range;
    return item;
  });
}

/** True when the cursor is inside an unterminated string literal on this line. */
function isInsideString(prefix: string): boolean {
  let inString = false;
  for (let i = 0; i < prefix.length; i += 1) {
    const ch = prefix[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    }
  }
  return inString;
}
