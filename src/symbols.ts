// How symbols look in VS Code: hover text and completion items. The parsing lives in `parser.ts`.

import * as vscode from "vscode";
import type { SymbolDoc, SymbolKind } from "./parser";

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

const K = vscode.CompletionItemKind;

const COMPLETION_KIND: Record<SymbolKind, vscode.CompletionItemKind> = {
  function: K.Function,
  method: K.Method,
  struct: K.Struct,
  class: K.Class,
  interface: K.Interface,
  enum: K.Enum,
  enumMember: K.EnumMember,
  type: K.TypeParameter,
  define: K.Constant,
  const: K.Constant,
  global: K.Variable,
  variable: K.Variable,
  field: K.Field,
  module: K.Module,
};

export function symbolToCompletion(sym: SymbolDoc, sortPrefix: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(sym.name, COMPLETION_KIND[sym.kind]);
  item.detail = sym.signature;
  item.documentation = symbolToHover(sym);
  item.sortText = `${sortPrefix}_${sym.name}`;
  if (sym.kind === "function" || sym.kind === "method") {
    item.insertText = new vscode.SnippetString(`${sym.name}($0)`);
  } else if (sym.kind === "define" && sym.detail === "macro") {
    item.insertText = new vscode.SnippetString(`${sym.name}!($0)`);
  } else if (sym.kind === "enumMember" && sym.detail === "payload variant") {
    item.insertText = new vscode.SnippetString(`${sym.name}($0)`);
  }
  return item;
}
