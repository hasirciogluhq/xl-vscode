import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { findStdRoot } from "./paths";

const DIAGNOSTIC_SOURCE = "xlang";

interface JsonLabel {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  text?: string;
}

interface JsonDiagnostic {
  code?: string;
  severity?: string;
  suppressed?: boolean;
  message: string;
  labels?: JsonLabel[];
  detail?: string;
  reason?: string;
  fix?: string;
}

export class XlangDiagnostics {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, number>();

  constructor(collection: vscode.DiagnosticCollection) {
    this.collection = collection;
  }

  dispose(): void {
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
    this.collection.dispose();
  }

  schedule(document: vscode.TextDocument, delayMs = 400): void {
    const key = document.uri.toString();
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.pending.delete(key);
      void this.refresh(document, true);
    }, delayMs);
    this.pending.set(key, timer);
  }

  clear(document: vscode.TextDocument): void {
    this.collection.delete(document.uri);
  }

  /**
   * Runs `xlang check` and publishes the result. With `fromBuffer` the unsaved editor text is
   * checked through a temporary sibling file, so relative imports keep working.
   */
  async refresh(document: vscode.TextDocument, fromBuffer = false): Promise<void> {
    const config = vscode.workspace.getConfiguration("xlang");
    if (!config.get<boolean>("enableDiagnostics", true) || document.uri.scheme !== "file") {
      this.collection.delete(document.uri);
      return;
    }

    const compilerPath = await resolveCompilerPath();
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

    let output: string;
    try {
      const result = await runProcess(
        compilerPath,
        ["check", target, ...compilerFlags(), ...stdFlags(filePath, compilerPath), "--diag-format", "json", "--context", "0"],
        path.dirname(filePath)
      );
      output = result.text;
    } catch {
      output = "";
    } finally {
      if (temp) {
        try {
          fs.unlinkSync(temp);
        } catch {
          // best effort
        }
      }
    }

    if (this.running.get(key) !== ticket) {
      return; // a newer run owns the result
    }
    this.collection.set(document.uri, toDiagnostics(output, document, target));
  }
}

function toDiagnostics(
  output: string,
  document: vscode.TextDocument,
  checkedFile: string
): vscode.Diagnostic[] {
  const own: vscode.Diagnostic[] = [];
  const foreign: vscode.Diagnostic[] = [];
  const sameFile = (file: string) => path.normalize(file) === path.normalize(checkedFile);

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

    const severity =
      d.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : d.severity === "note"
          ? vscode.DiagnosticSeverity.Information
          : vscode.DiagnosticSeverity.Error;

    const labels = d.labels ?? [];
    const primary = labels.find((l) => sameFile(l.file)) ?? labels[0];
    const parts = [d.message];
    if (primary?.text) {
      parts.push(primary.text);
    }
    if (d.detail) {
      parts.push(d.detail);
    }
    if (d.fix) {
      parts.push(`fix: ${d.fix}`);
    }
    const message = parts.join("\n");

    if (primary && sameFile(primary.file)) {
      const diag = new vscode.Diagnostic(rangeOf(primary, document), message, severity);
      diag.source = DIAGNOSTIC_SOURCE;
      if (d.code) {
        diag.code = d.code;
      }
      const related = labels
        .filter((l) => l !== primary)
        .map(
          (l) =>
            new vscode.DiagnosticRelatedInformation(
              new vscode.Location(
                sameFile(l.file) ? document.uri : vscode.Uri.file(l.file),
                new vscode.Position(Math.max(0, l.line - 1), Math.max(0, l.column - 1))
              ),
              l.text ?? "related location"
            )
        );
      if (related.length > 0) {
        diag.relatedInformation = related;
      }
      own.push(diag);
    } else {
      // The error is in another file (an import): surface it on the first line.
      const where = primary ? `${path.basename(primary.file)}:${primary.line}:${primary.column}` : "";
      const diag = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, Math.max(1, document.lineAt(0).text.length)),
        where ? `${where}: ${message}` : message,
        severity
      );
      diag.source = DIAGNOSTIC_SOURCE;
      if (d.code) {
        diag.code = d.code;
      }
      foreign.push(diag);
    }
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

/** `-D`, `--target` from the extension settings; shared by check / build / run / test. */
export function compilerFlags(): string[] {
  const config = vscode.workspace.getConfiguration("xlang");
  const flags: string[] = [];
  for (const define of config.get<string[]>("defines", [])) {
    if (define.trim()) {
      flags.push("-D", define.trim());
    }
  }
  const target = config.get<string>("target", "").trim();
  if (target) {
    flags.push("--target", target);
  }
  return flags;
}

/**
 * A file inside the stdlib sources is checked with `--no-std`: otherwise the compiler loads its
 * embedded copy of that same module next to the file being checked and reports every `export(c)`
 * symbol as defined twice (E0401).
 */
export function stdFlags(filePath: string, compilerPath: string): string[] {
  const stdRoot = findStdRoot(filePath, compilerPath);
  if (!stdRoot) {
    return [];
  }
  const rel = path.relative(stdRoot, path.normalize(filePath));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? ["--no-std"] : [];
}

export async function resolveCompilerPath(): Promise<string> {
  const config = vscode.workspace.getConfiguration("xlang");
  const configured = config.get<string>("compilerPath", "").trim();
  if (configured) {
    return configured;
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const base of [folder.uri.fsPath, path.join(folder.uri.fsPath, "..")]) {
      const found = findBuiltXlang(base);
      if (found) {
        return found;
      }
    }
  }
  return "xlang";
}

/** Prefer outputs/xlang; fall back to xmake's outputs/<plat>/<arch>/<mode>/xlang. */
function findBuiltXlang(root: string): string | undefined {
  const exe = process.platform === "win32" ? "xlang.exe" : "xlang";
  const direct = path.normalize(path.join(root, "outputs", exe));
  if (fs.existsSync(direct)) {
    return direct;
  }

  const buildDir = path.join(root, "outputs");
  if (!fs.existsSync(buildDir)) {
    return undefined;
  }
  try {
    for (const plat of fs.readdirSync(buildDir, { withFileTypes: true })) {
      if (!plat.isDirectory() || plat.name.startsWith(".")) {
        continue;
      }
      const platDir = path.join(buildDir, plat.name);
      for (const arch of fs.readdirSync(platDir, { withFileTypes: true })) {
        if (!arch.isDirectory()) {
          continue;
        }
        for (const mode of ["release", "debug"]) {
          const candidate = path.normalize(path.join(platDir, arch.name, mode, exe));
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface ProcessResult {
  /** stdout followed by stderr. */
  text: string;
  /** Exit status; `null` when the process was killed (timeout). */
  code: number | null;
}

/** Runs a process; resolves with its output and exit status whatever that status is. */
export function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error(`xlang compiler not found: ${command}. Build it or set xlang.compilerPath.`));
          return;
        }
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ text: `${stdout.toString()}\n${stderr.toString()}`, code });
      }
    );
  });
}
