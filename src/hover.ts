import * as vscode from "vscode";
import { DIAGNOSTIC_CODES, catalogToHover, findCatalogEntry } from "./builtins";
import { getLanguageIndex } from "./languageIndex";
import { symbolToHover } from "./symbols";

const IDENT = /[A-Za-z_]\w*/;
const CODE = /\b[EW]\d{4}\b/;

export function registerHover(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("xlang", {
      provideHover(document, position) {
        const index = getLanguageIndex();

        const codeRange = document.getWordRangeAtPosition(position, CODE);
        if (codeRange) {
          const code = document.getText(codeRange);
          const text = DIAGNOSTIC_CODES[code];
          if (text) {
            const md = new vscode.MarkdownString(`**${code}** ${text}\n\nRun \`xlang --explain ${code}\` for the long form.`);
            return new vscode.Hover(md, codeRange);
          }
        }

        const word = document.getWordRangeAtPosition(position, IDENT);
        if (!word) {
          return null;
        }
        const name = document.getText(word);

        // `a.b`: resolve through the type of `a`.
        const before = document.lineAt(position.line).text.slice(0, word.start.character);
        const chain = /([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\.\s*$/.exec(before);
        if (chain) {
          const members = index.resolveMemberAccess(document, chain[1], position.line);
          const sym = members.find((s) => s.name === name);
          if (sym) {
            return new vscode.Hover(symbolToHover(sym), word);
          }
          return null;
        }

        const sym = index.findSymbol(document, name, position.line);
        if (sym) {
          return new vscode.Hover(symbolToHover(sym), word);
        }

        const catalog = findCatalogEntry(name);
        if (catalog) {
          return new vscode.Hover(catalogToHover(catalog), word);
        }
        return null;
      },
    })
  );
}

export function registerDefinitions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider("xlang", {
      provideDefinition(document, position) {
        const index = getLanguageIndex();

        // A module path inside an import string jumps to the module file.
        const lineText = document.lineAt(position.line).text;
        const importMatch = /^\s*(?:from|import|export)\b.*?"([^"]+)"/.exec(lineText);
        if (importMatch) {
          const start = lineText.indexOf(`"${importMatch[1]}"`);
          if (position.character >= start && position.character <= start + importMatch[1].length + 2) {
            const mod = index.getModule(importMatch[1], document.uri.fsPath);
            if (mod) {
              return new vscode.Location(vscode.Uri.file(mod.filePath), new vscode.Position(0, 0));
            }
          }
        }

        const word = document.getWordRangeAtPosition(position, IDENT);
        if (!word) {
          return null;
        }
        const name = document.getText(word);
        const before = lineText.slice(0, word.start.character);
        const chain = /([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\.\s*$/.exec(before);
        const sym = chain
          ? index.resolveMemberAccess(document, chain[1], position.line).find((s) => s.name === name)
          : index.findSymbol(document, name, position.line);
        if (sym?.filePath) {
          return new vscode.Location(
            vscode.Uri.file(sym.filePath),
            new vscode.Position(sym.line, 0)
          );
        }
        return null;
      },
    })
  );
}
