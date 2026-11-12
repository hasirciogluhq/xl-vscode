import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { buildArgs, resolveCompilerPath, runProcess } from "./compiler";

const DIAGNOSTIC_SOURCE = "xlc";

interface JsonLabel {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  text?: string;
}

interface JsonNote {
  file: string;
  line: number;
  column: number;
  message: string;
}

/** One line of `xlc --diag-format json`. */
interface JsonDiagnostic {
  code?: string;
  severity?: string;
  suppressed?: boolean;
  message: string;
  labels?: JsonLabel[];
  notes?: JsonNote[];
  detail?: string;
  reason?: string;
  fix?: string;
}

export class XlangDiagnostics {
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, number>();

  constructor(private readonly collection: vscode.DiagnosticCollection) {}

  dispose(): void {
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
    this.collection.dispose();
  }

  schedule(document: vscode.TextDocument, delayMs = 400): void {
    const key = document.uri.toString();
    clearTimeout(this.pending.get(key));
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        void this.refresh(document, true);
      }, delayMs)
    );
  }

  clear(document: vscode.TextDocument): void {
    this.collection.delete(document.uri);
  }

  /**
   * Runs `xlc <file> --check` and publishes the result. With `fromBuffer` the unsaved editor text is
   * checked through a temporary sibling file, so relative imports and the project keep working.
   */
  async refresh(document: vscode.TextDocument, fromBuffer = false): Promise<void> {
    const config = vscode.workspace.getConfiguration("xlang");
    if (!config.get<boolean>("enableDiagnostics", true) || document.uri.scheme !== "file") {
      this.collection.delete(document.uri);
      return;
    }

    const compilerPath = await resolveCompilerPath(document.uri.fsPath);
    const key = document.uri.toString();
    const ticket = (this.running.get(key) ?? 0) + 1;
    this.running.set(key, ticket);

    const filePath = document.uri.fsPath;
    let target = filePath;
    let temp: string | undefined;
    if (fromBuffer && document.isDirty) {
      temp = path.join(path.dirname(filePath), `.${path.basename(filePath, ".xl")}.xlang-buffer.xl`);
      try {
        fs.writeFileSync(temp, document.getText());
        target = temp;
      } catch {
        temp = undefined;
      }
    }

    let output = "";
    try {
      const { args } = buildArgs(filePath, compilerPath);
      output = (
        await runProcess(compilerPath, [target, "--check", ...args, "--diag-format", "json", "--context", "0"], path.dirname(filePath))
      ).text;
    } catch {
      // compiler missing: the status bar item says so, the editor stays quiet
    } finally {
      if (temp) {
        fs.rmSync(temp, { force: true });
      }
    }

    if (this.running.get(key) !== ticket) {
      return; // a newer run owns the result
    }
    this.collection.set(document.uri, toDiagnostics(output, document, target));
  }
}

const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  warning: vscode.DiagnosticSeverity.Warning,
  error: vscode.DiagnosticSeverity.Error,
};

function toDiagnostics(output: string, document: vscode.TextDocument, checkedFile: string): vscode.Diagnostic[] {
  const own: vscode.Diagnostic[] = [];
  const foreign: vscode.Diagnostic[] = [];
  const sameFile = (file: string) => path.normalize(file) === path.normalize(checkedFile);
  const location = (file: string, line: number, column: number) =>
    new vscode.Location(
      sameFile(file) ? document.uri : vscode.Uri.file(file),
      new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1))
    );

  for (const line of output.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) {
      continue;
    }
    let d: JsonDiagnostic;
    try {
      d = JSON.parse(text) as JsonDiagnostic;
    } catch {
      continue;
    }
    if (d.suppressed) {
      continue;
    }

    const labels = d.labels ?? [];
    const primary = labels.find((l) => sameFile(l.file)) ?? labels[0];
    const message = [
      d.message,
      primary?.text,
      d.detail,
      d.reason && `reason: ${d.reason}`,
      d.fix && `fix: ${d.fix}`,
    ]
      .filter(Boolean)
      .join("\n");

    const related = [
      ...labels.filter((l) => l !== primary).map((l) => new vscode.DiagnosticRelatedInformation(location(l.file, l.line, l.column), l.text ?? "related location")),
      ...(d.notes ?? [])
        .filter((n) => n.file)
        .map((n) => new vscode.DiagnosticRelatedInformation(location(n.file, n.line, n.column), n.message)),
    ];

    const inThisFile = primary && sameFile(primary.file);
    // The error is in another file (an import): surface it on the first line.
    const where = primary && !inThisFile ? `${path.basename(primary.file)}:${primary.line}:${primary.column}: ` : "";
    const diag = new vscode.Diagnostic(
      inThisFile ? rangeOf(primary, document) : new vscode.Range(0, 0, 0, Math.max(1, document.lineAt(0).text.length)),
      where + message,
      SEVERITY[d.severity ?? "error"] ?? vscode.DiagnosticSeverity.Error
    );
    diag.source = DIAGNOSTIC_SOURCE;
    if (d.code) {
      diag.code = d.code;
    }
    if (related.length > 0) {
      diag.relatedInformation = related;
    }
    (inThisFile ? own : foreign).push(diag);
  }
  return [...own, ...foreign];
}

function rangeOf(label: JsonLabel, document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(0, document.lineCount - 1);
  const startLine = Math.min(Math.max(0, label.line - 1), lastLine);
  const startChar = Math.max(0, label.column - 1);
  const endLine = Math.min(Math.max(startLine, (label.endLine ?? label.line) - 1), lastLine);
  let endChar = Math.max(0, (label.endColumn ?? label.column + 1) - 1);
  if (endLine === startLine && endChar <= startChar) {
    endChar = Math.max(startChar + 1, document.lineAt(startLine).text.length);
  }
  return new vscode.Range(startLine, startChar, endLine, endChar);
}
