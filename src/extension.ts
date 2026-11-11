import * as path from "node:path";
import * as vscode from "vscode";
import { registerCompletions } from "./completions";
import {
  XlangDiagnostics,
  compilerFlags,
  resolveCompilerPath,
  runProcess,
} from "./diagnostics";
import { formatXlangDocument } from "./formatter";
import { registerDefinitions, registerHover } from "./hover";
import { getLanguageIndex, resetLanguageIndex } from "./languageIndex";
import { TEST_SUFFIX } from "./paths";

let diagnostics: XlangDiagnostics | undefined;
let output: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("xlang");
  diagnostics = new XlangDiagnostics(collection);
  output = vscode.window.createOutputChannel("xlang");
  context.subscriptions.push(collection, output, { dispose: () => diagnostics?.dispose() });

  void resolveCompilerPath().then((p) => getLanguageIndex().setCompilerPath(p));

  const refreshIndex = (doc?: vscode.TextDocument) => {
    if (doc?.languageId === "xlang") {
      getLanguageIndex().invalidate(doc.uri);
    } else {
      resetLanguageIndex();
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === "xlang") {
        void diagnostics?.refresh(doc);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      refreshIndex(doc);
      if (doc.languageId === "xlang") {
        void diagnostics?.refresh(doc);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      refreshIndex(event.document);
      const config = vscode.workspace.getConfiguration("xlang");
      if (!config.get<boolean>("diagnosticsOnType", false)) {
        return;
      }
      if (event.document.languageId === "xlang") {
        diagnostics?.schedule(event.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics?.clear(doc);
      refreshIndex(doc);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("xlang")) {
        resetLanguageIndex();
        void resolveCompilerPath().then((p) => getLanguageIndex().setCompilerPath(p));
        for (const doc of vscode.workspace.textDocuments) {
          if (doc.languageId === "xlang") {
            void diagnostics?.refresh(doc);
          }
        }
      }
    })
  );

  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId === "xlang") {
      void diagnostics?.refresh(doc);
    }
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider("xlang", {
      provideDocumentFormattingEdits(document) {
        const tabSize = vscode.workspace
          .getConfiguration("xlang")
          .get<number>("formatter.tabSize", 4);
        return formatXlangDocument(document, tabSize);
      },
    })
  );

  registerCompletions(context);
  registerHover(context);
  registerDefinitions(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("xlang.formatDocument", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "xlang") {
        return;
      }
      await vscode.commands.executeCommand("editor.action.formatDocument");
    }),
    vscode.commands.registerCommand("xlang.runFile", () => runCurrentFile()),
    vscode.commands.registerCommand("xlang.buildFile", () => buildCurrentFile()),
    vscode.commands.registerCommand("xlang.checkFile", () => checkCurrentFile()),
    vscode.commands.registerCommand("xlang.testFile", () => testCurrentFile()),
    vscode.commands.registerCommand("xlang.testSuite", () => testSuite()),
    vscode.commands.registerCommand("xlang.explain", () => explainCode())
  );
}

export function deactivate(): void {
  diagnostics?.dispose();
  diagnostics = undefined;
  resetLanguageIndex();
}

async function activeXlangFile(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "xlang") {
    vscode.window.showWarningMessage("Open an xlang (.xl) file first.");
    return undefined;
  }
  if (editor.document.isDirty) {
    await editor.document.save();
  }
  return editor.document.uri.fsPath;
}

async function runCurrentFile(): Promise<void> {
  const filePath = await activeXlangFile();
  if (!filePath) {
    return;
  }
  if (isTestFile(filePath)) {
    vscode.window.showWarningMessage("*.test.xl files run with `xlang test`.");
    return;
  }
  const terminal = vscode.window.createTerminal({ name: "xlang run", cwd: path.dirname(filePath) });
  terminal.show();
  const binary = await resolveCompilerPath();
  terminal.sendText(commandLine(binary, ["run", filePath, ...compilerFlags()]));
}

async function buildCurrentFile(): Promise<void> {
  const filePath = await activeXlangFile();
  if (!filePath) {
    return;
  }
  if (isTestFile(filePath)) {
    vscode.window.showWarningMessage("*.test.xl files cannot be built; use `xlang test`.");
    return;
  }
  const out = path.join(path.dirname(filePath), path.basename(filePath, ".xl"));
  await runInChannel(["build", filePath, "-o", out, ...compilerFlags()], path.dirname(filePath), `Built ${path.basename(out)}`);
}

async function checkCurrentFile(): Promise<void> {
  const filePath = await activeXlangFile();
  if (!filePath) {
    return;
  }
  await runInChannel(["check", filePath, ...compilerFlags()], path.dirname(filePath), "No problems found");
}

async function runInChannel(args: string[], cwd: string, successMessage: string): Promise<void> {
  const binary = await resolveCompilerPath();
  output?.clear();
  output?.appendLine(`$ ${commandLine(binary, args)}`);
  try {
    const result = await runProcess(binary, args, cwd, 120_000);
    output?.appendLine(result.text.trim());
    if (result.code !== 0) {
      output?.show(true);
      vscode.window.showErrorMessage("xlang reported errors (see the xlang output).");
    } else {
      vscode.window.showInformationMessage(successMessage);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(message);
  }
}

async function testCurrentFile(): Promise<void> {
  const filePath = await activeXlangFile();
  if (!filePath) {
    return;
  }
  const cwd = resolveWorkspaceRoot(filePath);
  const terminal = vscode.window.createTerminal({ name: "xlang test", cwd });
  terminal.show();
  const binary = await resolveCompilerPath();
  const target = isTestFile(filePath) ? filePath : resolveTestRoot(cwd);
  terminal.sendText(commandLine(binary, ["test", target, ...compilerFlags()]));
}

async function testSuite(): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const terminal = vscode.window.createTerminal({ name: "xlang test", cwd });
  terminal.show();
  const binary = await resolveCompilerPath();
  terminal.sendText(commandLine(binary, ["test", resolveTestRoot(cwd), ...compilerFlags()]));
}

async function explainCode(): Promise<void> {
  const code = await vscode.window.showInputBox({
    prompt: "Diagnostic code (for example E0709 or W0701)",
    validateInput: (value) => (/^[EW]\d{4}$/.test(value.trim()) ? undefined : "Expected E#### or W####"),
  });
  if (!code) {
    return;
  }
  const binary = await resolveCompilerPath();
  try {
    const result = await runProcess(binary, ["--explain", code.trim()], process.cwd(), 15_000);
    output?.clear();
    output?.appendLine(result.text.trim());
    output?.show(true);
  } catch (error: unknown) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

function resolveTestRoot(cwd: string): string {
  const configured = vscode.workspace.getConfiguration("xlang").get<string>("testRoot", "test").trim();
  return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
}

function resolveWorkspaceRoot(filePath: string): string {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return folder?.uri.fsPath ?? path.dirname(filePath);
}

function isTestFile(filePath: string): boolean {
  return filePath.endsWith(TEST_SUFFIX);
}

function commandLine(binary: string, args: string[]): string {
  return [binary, ...args].map(quote).join(" ");
}

function quote(value: string): string {
  if (/[\s"'\\]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
