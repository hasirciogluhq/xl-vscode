import * as vscode from "vscode";

export function formatXlangDocument(document: vscode.TextDocument, tabSize: number): vscode.TextEdit[] {
  const text = document.getText();
  const range = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
  return [vscode.TextEdit.replace(range, formatLines(text.split("\n"), tabSize))];
}

/**
 * Re-indents by brace depth. Lines inside a block comment keep their text (only trailing blanks go),
 * and braces in strings, byte literals (`b'{'`) and comments do not count.
 */
function formatLines(lines: string[], tabSize: number): string {
  const unit = " ".repeat(tabSize);
  const output: string[] = [];
  let indent = 0;
  let inBlock = false;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, unit).trimEnd();
    const trimmed = line.trim();

    if (inBlock) {
      output.push(line);
      inBlock = !trimmed.includes("*/");
      continue;
    }
    if (trimmed.length === 0) {
      output.push("");
      continue;
    }

    const level = trimmed.startsWith("}") ? Math.max(0, indent - 1) : indent;
    output.push(unit.repeat(level) + trimmed);

    const { delta, openBlock } = scan(trimmed);
    indent = Math.max(0, indent + delta);
    inBlock = openBlock;
  }

  const text = output.join("\n");
  return text.endsWith("\n") ? text : text + "\n";
}

/** Net brace change of a line, and whether it leaves a block comment open. */
function scan(line: string): { delta: number; openBlock: boolean } {
  let delta = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' || (ch === "b" && next === "'" && !/\w/.test(line[i - 1] ?? ""))) {
      const quote = ch === '"' ? '"' : "'";
      i += ch === '"' ? 1 : 2;
      while (i < line.length && line[i] !== quote) {
        i += line[i] === "\\" ? 2 : 1;
      }
    } else if (ch === "/" && next === "/") {
      break;
    } else if (ch === "/" && next === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        return { delta, openBlock: true };
      }
      i = end + 1;
    } else if (ch === "{") {
      delta += 1;
    } else if (ch === "}") {
      delta -= 1;
    }
  }
  return { delta, openBlock: false };
}
