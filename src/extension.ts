import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { registerCompletions } from "./completions";
import { buildArgs, resolveCliPath, resolveCompilerPath, runProcess } from "./compiler";
import { XlangDiagnostics } from "./diagnostics";
import { formatXlangDocument } from "./formatter";
import { registerDefinitions, registerHover } from "./hover";
import { getLanguageIndex, resetLanguageIndex } from "./languageIndex";
import { SOURCE_EXT, TEST_SUFFIX } from "./paths";
import { MANIFEST_NAME, resetProjectCache } from "./project";
import { type Job, runJobs } from "./runner";

let diagnostics: XlangDiagnostics | undefined;
let output: vscode.OutputChannel | undefined;
let status: vscode.StatusBarItem | undefined;

const EXE = process.platform === "win32" ? ".exe" : "";
const isTestFile = (filePath: string): boolean => filePath.endsWith(TEST_SUFFIX);
const xlangDocuments = () => vscode.workspace.textDocuments.filter((d) => d.languageId === "xlang");

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("xlang");
  diagnostics = new XlangDiagnostics(collection);
  output = vscode.window.createOutputChannel("xlang");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  status.command = "xlang.showEnvironment";
  context.subscriptions.push(collection, output, status, { dispose: () => diagnostics?.dispose() });

  const refreshCompiler = async () => {
    const compiler = await resolveCompilerPath();
    getLanguageIndex().setCompilerPath(compiler);
    await updateStatus(compiler);
  };
  void refreshCompiler();

  /** The project layout changed (manifest, lock, package cache): forget it and check again. */
  const projectChanged = () => {
    resetProjectCache();
    resetLanguageIndex();
    void refreshCompiler();
    xlangDocuments().forEach((doc) => void diagnostics?.refresh(doc));
  };

  const refreshIndex = (doc: vscode.TextDocument) => {
    if (doc.languageId === "xlang") {
      getLanguageIndex().invalidate(doc.uri);
    }
  };

  const watcher = vscode.workspace.createFileSystemWatcher("**/{xlang.toml,xlang.lock}");
  const cacheWatcher = vscode.workspace.createFileSystemWatcher("**/.xlang/cache/*");
  for (const w of [watcher, cacheWatcher]) {
    w.onDidChange(projectChanged);
    w.onDidCreate(projectChanged);
    w.onDidDelete(projectChanged);
    context.subscriptions.push(w);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === "xlang") {
        void diagnostics?.refresh(doc);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (path.basename(doc.uri.fsPath) === MANIFEST_NAME) {
        projectChanged();
        return;
      }
      refreshIndex(doc);
      if (doc.languageId === "xlang") {
        void diagnostics?.refresh(doc);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      refreshIndex(event.document);
      if (event.document.languageId === "xlang" && vscode.workspace.getConfiguration("xlang").get<boolean>("diagnosticsOnType", false)) {
        diagnostics?.schedule(event.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics?.clear(doc);
      refreshIndex(doc);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("xlang")) {
        projectChanged();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.languageId === "xlang") {
        status?.show();
      } else {
        status?.hide();
      }
    })
  );

  xlangDocuments().forEach((doc) => void diagnostics?.refresh(doc));
  if (vscode.window.activeTextEditor?.document.languageId === "xlang") {
    status.show();
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider("xlang", {
      provideDocumentFormattingEdits(document) {
        return formatXlangDocument(document, vscode.workspace.getConfiguration("xlang").get<number>("formatter.tabSize", 4));
      },
    }),
    vscode.languages.registerCodeActionsProvider("xlang", new PackageActions(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    })
  );

  registerCompletions(context);
  registerHover(context);
  registerDefinitions(context);

  const commands: Record<string, (...args: string[]) => unknown> = {
    "xlang.formatDocument": () => vscode.commands.executeCommand("editor.action.formatDocument"),
    "xlang.runFile": runCurrentFile,
    "xlang.buildFile": buildCurrentFile,
    "xlang.checkFile": checkCurrentFile,
    "xlang.testFile": testCurrentFile,
    "xlang.testSuite": testSuite,
    "xlang.explain": explainCode,
    "xlang.showLayout": () => showCompilerOutput(["--dump-layout"], "layout"),
    "xlang.showIR": () => showCompilerOutput(["--emit=ir", "-o", "-"], "ir", "llvm"),
    "xlang.showHIR": () => showCompilerOutput(["--dump-hir"], "hir"),
    "xlang.showEnvironment": showEnvironment,
    "xlang.packageInstall": (spec?: string) => packageInstall(spec),
    "xlang.packageUpdate": () => packageCommand(["update"]),
    "xlang.packageRemove": packageRemove,
    "xlang.packageList": () => packageCommand(["list"]),
    "xlang.packageClean": () => packageCommand(["clean"]),
  };
  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
}

export function deactivate(): void {
  diagnostics?.dispose();
  diagnostics = undefined;
  resetLanguageIndex();
}

// ---------------------------------------------------------------------------------------------
// Status bar and environment

async function compilerVersion(compiler: string): Promise<string | undefined> {
  try {
    const result = await runProcess(compiler, ["--version"], process.cwd(), 10_000);
    return result.code === 0 ? result.text.trim().split(/\s+/).pop() : undefined;
  } catch {
    return undefined;
  }
}

async function updateStatus(compiler: string): Promise<void> {
  const version = await compilerVersion(compiler);
  if (!status) {
    return;
  }
  status.text = version ? `$(zap) xlc ${version}` : "$(warning) xlc not found";
  status.tooltip = version ? `${compiler}\nClick for the module roots in use.` : "Build xlc or set xlang.compilerPath.";
  status.backgroundColor = version ? undefined : new vscode.ThemeColor("statusBarItem.warningBackground");
}

async function showEnvironment(): Promise<void> {
  const compiler = await resolveCompilerPath();
  const file = vscode.window.activeTextEditor?.document.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const lines = [`compiler:  ${compiler} (${(await compilerVersion(compiler)) ?? "not found"})`, `cli:       ${resolveCliPath()}`];
  if (file) {
    const { args, context } = buildArgs(file, compiler);
    lines.push(
      `file:      ${file}`,
      `project:   ${context.projectDir ?? "(no xlang.toml above the file)"}`,
      `std:       ${context.stdRoot ?? "(not found: set xlang.stdPath or check out xl-std)"}`,
      "module roots (-M):",
      ...(context.roots.length ? context.roots.map((r) => `  ${r.name} = ${r.dir}`) : ["  (none)"]),
      ...(context.missing.length ? [`missing (run xl install): ${context.missing.join(", ")}`] : []),
      `xlc flags: ${args.join(" ")}`
    );
  }
  output?.clear();
  output?.appendLine(lines.join("\n"));
  output?.show(true);
}

// ---------------------------------------------------------------------------------------------
// Compiler commands

async function activeXlangFile(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "xlang") {
    void vscode.window.showWarningMessage("Open an xlang (.xl) file first.");
    return undefined;
  }
  if (editor.document.isDirty) {
    await editor.document.save();
  }
  return editor.document.uri.fsPath;
}

/** Builds `file` into a temporary executable and runs it in the job terminal. */
function buildAndRunJob(compiler: string, file: string, title: string, id: number): Job {
  const { args } = buildArgs(file, compiler);
  const exe = path.join(os.tmpdir(), `xlang-${process.pid}-${id}-${path.basename(file, SOURCE_EXT)}${EXE}`);
  const cwd = path.dirname(file);
  return {
    title,
    commands: [
      { command: compiler, args: [file, ...args, "-o", exe, "--color", "always"], cwd },
      { command: exe, args: [], cwd },
    ],
    cleanup: () => fs.rmSync(exe, { force: true }),
  };
}

async function runCurrentFile(): Promise<void> {
  const file = await activeXlangFile();
  if (!file) {
    return;
  }
  if (isTestFile(file)) {
    void vscode.window.showWarningMessage("A *.test.xl file is a test: use xlang: Test Current File.");
    return;
  }
  runJobs("xl run", [buildAndRunJob(await resolveCompilerPath(), file, path.basename(file), 0)]);
}

async function buildCurrentFile(): Promise<void> {
  const file = await activeXlangFile();
  if (!file) {
    return;
  }
  const compiler = await resolveCompilerPath();
  const out = path.join(path.dirname(file), path.basename(file, SOURCE_EXT) + EXE);
  await runInChannel(compiler, [file, ...buildArgs(file, compiler).args, "-o", out], path.dirname(file), `Built ${path.basename(out)}`);
}

async function checkCurrentFile(): Promise<void> {
  const file = await activeXlangFile();
  if (!file) {
    return;
  }
  const compiler = await resolveCompilerPath();
  await runInChannel(compiler, [file, "--check", ...buildArgs(file, compiler).args], path.dirname(file), "No problems found");
}

async function runInChannel(binary: string, args: string[], cwd: string, successMessage: string): Promise<void> {
  output?.clear();
  output?.appendLine(`$ ${[binary, ...args].join(" ")}`);
  try {
    const result = await runProcess(binary, args, cwd, 120_000);
    output?.appendLine(result.text.trim());
    if (result.code !== 0) {
      output?.show(true);
      void vscode.window.showErrorMessage("xlc reported errors (see the xlang output).");
    } else {
      void vscode.window.showInformationMessage(successMessage);
    }
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

/** Runs a dump option of the compiler on the active file and shows the text in a new editor. */
async function showCompilerOutput(extra: string[], what: string, language = "plaintext"): Promise<void> {
  const file = await activeXlangFile();
  if (!file) {
    return;
  }
  const compiler = await resolveCompilerPath();
  try {
    const result = await runProcess(compiler, [file, ...buildArgs(file, compiler).args, ...extra], path.dirname(file), 120_000);
    if (result.code !== 0) {
      output?.clear();
      output?.appendLine(result.text.trim());
      output?.show(true);
      void vscode.window.showErrorMessage(`xlc could not produce the ${what} (see the xlang output).`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument({ content: result.text.trim() + "\n", language });
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function explainCode(): Promise<void> {
  const code = await vscode.window.showInputBox({
    prompt: "Diagnostic code (for example E0709 or W0701)",
    validateInput: (value) => (/^[EW]\d{4}$/.test(value.trim()) ? undefined : "Expected E#### or W####"),
  });
  if (!code) {
    return;
  }
  try {
    const result = await runProcess(await resolveCompilerPath(), ["--explain", code.trim()], process.cwd(), 15_000);
    output?.clear();
    output?.appendLine(result.text.trim());
    output?.show(true);
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------------------------------------
// Tests: every `*.test.xl` is built into an executable and run; a non-zero status fails the file.

async function testFilesUnder(root: string): Promise<string[]> {
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, `**/*${TEST_SUFFIX}`),
    "**/{node_modules,.xlang,build,out}/**"
  );
  return uris.map((u) => u.fsPath).sort();
}

async function runTests(files: string[]): Promise<void> {
  if (files.length === 0) {
    void vscode.window.showWarningMessage(`No ${TEST_SUFFIX} files found.`);
    return;
  }
  const compiler = await resolveCompilerPath();
  const base = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  runJobs(
    "xl test",
    files.map((file, id) => buildAndRunJob(compiler, file, base ? path.relative(base, file) : file, id))
  );
}

async function testCurrentFile(): Promise<void> {
  const file = await activeXlangFile();
  if (!file) {
    return;
  }
  await (isTestFile(file) ? runTests([file]) : testSuite());
}

async function testSuite(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showWarningMessage("Open a folder first.");
    return;
  }
  const configured = vscode.workspace.getConfiguration("xlang").get<string>("testRoot", "test").trim();
  const root = path.isAbsolute(configured) ? configured : path.join(folder, configured);
  await runTests(await testFilesUnder(fs.existsSync(root) ? root : folder));
}

// ---------------------------------------------------------------------------------------------
// Packages: the xlang tool downloads them; the editor only starts it where the manifest is.

function projectDirectory(): string | undefined {
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const start = file ? path.dirname(file) : folder;
  if (!start) {
    return undefined;
  }
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, MANIFEST_NAME))) {
      return dir;
    }
    if (path.dirname(dir) === dir) {
      return folder ?? start;
    }
  }
}

function packageCommand(args: string[]): void {
  const cwd = projectDirectory();
  if (!cwd) {
    void vscode.window.showWarningMessage("Open a folder first.");
    return;
  }
  runJobs("xl package", [{ title: `package ${args[0]}`, commands: [{ command: resolveCliPath(), args, cwd }] }], projectChangedSoon);
}

/** Reloads the project after a package command finished (the watchers also catch most changes). */
function projectChangedSoon(): void {
  resetProjectCache();
  resetLanguageIndex();
  void resolveCompilerPath().then((compiler) => getLanguageIndex().setCompilerPath(compiler));
  xlangDocuments().forEach((doc) => void diagnostics?.refresh(doc));
}

async function packageInstall(spec?: string): Promise<void> {
  const target =
    spec ??
    (await vscode.window.showInputBox({
      prompt: "Repository to add (host/user/repo or host/user/repo@v1.2.0). Empty installs everything xlang.toml lists.",
      placeHolder: "github.com/user/repo",
    }));
  if (target === undefined) {
    return;
  }
  packageCommand(target.trim() ? ["install", target.trim()] : ["install"]);
}

async function packageRemove(): Promise<void> {
  const target = await vscode.window.showInputBox({ prompt: "Repository to remove from xlang.toml", placeHolder: "github.com/user/repo" });
  if (target?.trim()) {
    packageCommand(["remove", target.trim()]);
  }
}

/** Quick fix for an import of a package that is not on disk. */
class PackageActions implements vscode.CodeActionProvider {
  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      const module = /module `([^`]+)` not found/.exec(diagnostic.message)?.[1];
      // A repository path: `host.tld/user/repo[/sub]`; the first segment has a dot.
      const repository = module && /^[^/]*\.[^/]*\/[^/]+\/[^/]+/.test(module) ? module.split("/").slice(0, 3).join("/") : undefined;
      if (!repository) {
        continue;
      }
      const install = new vscode.CodeAction(`Install package ${repository}`, vscode.CodeActionKind.QuickFix);
      install.command = { command: "xlang.packageInstall", title: "Install package", arguments: [repository] };
      install.diagnostics = [diagnostic];
      install.isPreferred = true;
      actions.push(install);
    }
    return actions;
  }
}
