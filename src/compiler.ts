import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { type ModuleContext, isInside, moduleContext } from "./paths";

const EXE = process.platform === "win32" ? ".exe" : "";

const settings = () => vscode.workspace.getConfiguration("xlang");

/** Names the compiler binary can have in a build tree, nearest to the workspace first. */
function findBuiltCompiler(root: string): string | undefined {
  const direct = [path.join(root, "outputs", "xlc" + EXE), path.join(root, "build", "xlc" + EXE)];
  const found = direct.find((p) => fs.existsSync(p));
  if (found) {
    return found;
  }
  // xmake: build/<plat>/<arch>/<mode>/xlc
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
 * The `xlc` binary: the `xlang.compilerPath` setting, a build in the workspace (or its `xlc/`
 * submodule), `~/.local/bin/xlc`, then whatever `xlc` is on `PATH`.
 */
export async function resolveCompilerPath(): Promise<string> {
  const configured = settings().get<string>("compilerPath", "").trim();
  if (configured) {
    return configured;
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

/** The `xlang` tool (packages, self-update): `xlang.cliPath`, else `xlang` on `PATH`. */
export function resolveCliPath(): string {
  return settings().get<string>("cliPath", "").trim() || "xl";
}

export interface BuildArgs {
  args: string[];
  context: ModuleContext;
}

/**
 * Flags shared by check / build / run / test of `filePath`: the module roots (`-M`), the stdlib
 * (`-M std=` plus `--import std`), `-D` definitions, `--target`, `--safety`, `-O` and the extra
 * arguments from the settings. A file that sits inside a root is itself part of that root, so the
 * root is left out to keep the file from being loaded twice.
 */
export function buildArgs(filePath: string, compilerPath: string): BuildArgs {
  const config = settings();
  const context = moduleContext(filePath, compilerPath);
  const args: string[] = [];

  const roots = context.roots.filter((r) => !isInside(filePath, r.dir));
  for (const root of roots) {
    args.push("-M", `${root.name}=${root.dir}`);
  }
  if (roots.some((r) => r.name === "std") && !config.get<boolean>("noStd", false)) {
    args.push("--import", "std");
  }
  for (const feature of config.get<string[]>("features", ["DefaultAllocator"])) {
    if (feature.trim()) {
      args.push(`-Dfeature${feature.trim()}=true`);
    }
  }
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
        reject(new Error(`xlang compiler not found: ${command}. Build xlc or set xlang.compilerPath.`));
        return;
      }
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ text: `${stdout.toString()}\n${stderr.toString()}`, code });
    });
  });
}
