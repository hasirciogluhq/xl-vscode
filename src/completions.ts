import * as vscode from "vscode";
import {
  ATTRIBUTES,
  BUILTINS,
  DIRECTIVES,
  KEYWORDS,
  MEMORY_ORDERS,
  ROLES,
  TYPES,
  catalogToCompletion,
} from "./builtins";
import { getLanguageIndex } from "./languageIndex";
import { listModulePaths } from "./paths";
import { symbolToCompletion } from "./symbols";

const TRIGGER_CHARS = [".", "@", "#", '"', "/", ...Array.from("abcdefghijklmnopqrstuvwxyz")];

export function registerCompletions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "xlang",
      {
        provideCompletionItems(document, position) {
          const index = getLanguageIndex();
          const line = document.lineAt(position.line).text;
          const prefix = line.slice(0, position.character);

          // Module path inside `from "..." import` / `import "..."` / `from "..."`.
          const modulePrefix = /(?:\bfrom|\bimport(?:\s+\*(?:\s+as\s+\w+)?\s+from)?|\bexport\s+\*(?:\s+as\s+\w+)?\s+from)\s+"([^"]*)$/.exec(prefix);
          if (modulePrefix) {
            return moduleCompletions(index, document, modulePrefix[1]);
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
            const members = index.resolveMemberAccess(document, member[1], position.line);
            return members.map((sym) => symbolToCompletion(sym, "0"));
          }

          // `: ` / `->` / `as` / `*`: type position.
          const typePosition = /(?::\s*|->\s*|\bas\s+|\*\s*|\[\s*)\w*$/.test(prefix);

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
            for (const p of scope.params) {
              const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Variable);
              item.detail = p.type ? `${p.name}: ${p.type}` : p.name;
              item.sortText = `0_${p.name}`;
              items.push(item);
            }
            for (const l of scope.locals) {
              if (l.line > position.line) {
                continue;
              }
              const item = new vscode.CompletionItem(l.name, vscode.CompletionItemKind.Variable);
              item.detail = l.type ? `${l.name}: ${l.type}` : l.name;
              item.sortText = `0_${l.name}`;
              items.push(item);
            }
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
  typed: string
): vscode.CompletionItem[] {
  const contextFile = document.uri.fsPath;
  const items: vscode.CompletionItem[] = [];
  for (const modulePath of listModulePaths(contextFile, index.stdRoot(contextFile))) {
    if (!modulePath.startsWith(typed.split("/").slice(0, -1).join("/"))) {
      continue;
    }
    const item = new vscode.CompletionItem(modulePath, vscode.CompletionItemKind.Module);
    item.detail = modulePath === "std" || modulePath.startsWith("std/") ? "standard library" : "module";
    item.documentation = new vscode.MarkdownString(index.moduleDescription(modulePath, contextFile));
    item.sortText = `${modulePath.startsWith("std") ? "1" : "0"}_${modulePath}`;
    item.filterText = modulePath;
    items.push(item);
  }
  return items;
}

/** True when the cursor is inside an unterminated string literal on this line. */
function isInsideString(prefix: string): boolean {
  let inString = false;
  let escaped = false;
  for (const ch of prefix) {
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
    }
  }
  return inString;
}
