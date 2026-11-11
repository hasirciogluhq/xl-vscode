import * as vscode from "vscode";

export function formatXlangDocument(
  document: vscode.TextDocument,
  tabSize: number
): vscode.TextEdit[] {
  const lines = document.getText().split("\n");
  const formatted = formatLines(lines, tabSize);
  const range = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );

  return [vscode.TextEdit.replace(range, formatted)];
}

function formatLines(lines: string[], tabSize: number): string {
  const indentUnit = " ".repeat(tabSize);
  const output: string[] = [];
  let indent = 0;
  let inString = false;

  for (let rawLine of lines) {
    rawLine = rawLine.replace(/\t/g, indentUnit).trimEnd();

    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      output.push("");
      continue;
    }

    let level = indent;
    if (!inString && trimmed.startsWith("}")) {
      level = Math.max(0, indent - 1);
    }

    output.push(`${indentUnit.repeat(level)}${trimmed}`);

    const delta = braceDelta(trimmed);
    indent = Math.max(0, indent + delta);
  }

  let text = output.join("\n");
  if (!text.endsWith("\n")) {
    text += "\n";
  }
  return text;
}

function braceDelta(line: string): number {
  let delta = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "/" && line[i + 1] === "/") {
      break;
    }

    if (ch === "{") {
      delta += 1;
    } else if (ch === "}") {
      delta -= 1;
    }
  }

  return delta;
}
