import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { type ModuleContext, environmentFor, isInside, moduleContext } from "./paths";

const EXE = process.platform === "win32" ? ".exe" : "";

const settings = () => vscode.workspace.getConfiguration("xlang");

/** A compiler built in a source tree: `build/<plat>/<arch>/<mode>/xlc` (xmake), `build/xlc` or `outputs/xlc`. */
function findBuiltCompiler(root: string): string | undefined {
  const direct = [path.join(root, "outputs", "xlc" + EXE), path.join(root, "build", "xlc" + EXE)];
  const found = direct.find((p) => fs.existsSync(p));
  if (found) {
    return found;
  }
  const buildDir = path.join(root, "build");
  try {
    for (const plat of fs.readdirSync(buildDir, { withFileTypes: true })) {
      if (!plat.isDirectory()) {
        continue;
      }
      for (const arch of fs.readdirSync(path.join(buildDir, plat.name), { withFileTypes: true })) {
        for (const mode of ["release", "debug"]) {
          const candidate = path.join(buildDir, plat.name, arch.name, mode, "xlc" + EXE);
          if (arch.isDirectory() && fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    }
  } catch {
    // no build tree here
  }
  return undefined;
}

/**
 * The `xlc` binary for `filePath`: the `xlang.compilerPath` setting; the compiler of the file's build environment (`xl env`: the
 * active `xl lc` toolchain, `[toolchain] xlc` of xlang.local.toml, `$XLC`); a build in the workspace (or its `xlc/` submodule);
 * then `xlc` on `PATH`.
 */
export async function resolveCompilerPath(filePath?: string): Promise<string> {
  const configured = settings().get<string>("compilerPath", "").trim();
  if (configured) {
    return configured;
  }
  const file = filePath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
  if (file && path.isAbsolute(file)) {
    const xlc = environmentFor(file).xlc;
    if (xlc && fs.existsSync(xlc)) {
      return xlc;
    }
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const base of [folder.uri.fsPath, path.join(folder.uri.fsPath, "xlc"), path.dirname(folder.uri.fsPath)]) {
      const found = findBuiltCompiler(base);
      if (found) {
        return found;
      }
    }
  }
  const local = path.join(os.homedir(), ".local", "bin", "xlc" + EXE);
  return fs.existsSync(local) ? local : "xlc";
}

export interface BuildArgs {
  args: string[];
  context: ModuleContext;
}

/**
 * Flags shared by check / build / run / test of `filePath`: the build environment of xl (the stdlib with `--import std` and its
 * features, the package roots, the `[build] flags` of xlang.local.toml), then the editor's own settings (`-D`, `--target`,
 * `--safety`, `-O`, extra arguments). A file inside a module root is itself part of that root, so the root is left out to keep the
 * file from being loaded twice.
 */
export function buildArgs(filePath: string, compilerPath: string): BuildArgs {
  const config = settings();
  const context = moduleContext(filePath, compilerPath);
  const args: string[] = [];
  // A module of a root, but not one of its tests (`test/`), which import the root like any program does.
  const partOf = (dir: string) => isInside(filePath, dir) && !path.relative(dir, filePath).split(path.sep).includes("test");

  if (!config.get<boolean>("noStd", false)) {
    if (context.stdRoot && !partOf(context.stdRoot)) {
      args.push("-M", `std=${context.stdRoot}`, "--import", "std");
    }
    args.push("-DfeatureDefaultAllocator=true");
  }
  for (const root of context.environment.modules.filter((r) => !partOf(r.dir))) {
    args.push("-M", `${root.name}=${root.dir}`);
  }
  args.push(...context.environment.flags);
  for (const define of config.get<string[]>("defines", [])) {
    if (define.trim()) {
      args.push("-D", define.trim());
    }
  }
  const target = config.get<string>("target", "").trim();
  if (target) {
    args.push("--target", target);
  }
  const safety = config.get<string>("safety", "").trim();
  if (safety) {
    args.push("--safety", safety);
  }
  const opt = config.get<string>("optLevel", "").trim();
  if (opt) {
    args.push(`-O${opt}`);
  }
  args.push(...config.get<string[]>("extraArgs", []));
  return { args, context };
}

export interface ProcessResult {
  /** stdout followed by stderr. */
  text: string;
  /** Exit status; `null` when the process was killed (timeout). */
  code: number | null;
}

/** Runs a process; resolves with its output and exit status whatever that status is. */
export function runProcess(command: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`${command} not found. Run \`xl lc install\`, or set xlang.compilerPath / xlang.cliPath.`));
        return;
      }
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ text: `${stdout.toString()}\n${stderr.toString()}`, code });
    });
  });
}
