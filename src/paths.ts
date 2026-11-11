import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export const SOURCE_EXT = ".xl";
export const TEST_SUFFIX = ".test.xl";

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isStdRoot(dir: string): boolean {
  return isFile(path.join(dir, "index" + SOURCE_EXT));
}

/**
 * The directory holding the standard library sources (`std/index.xl`), used only for
 * IntelliSense: the compiler has its own embedded copy. Order: `xlang.stdPath`, a `std/` above
 * the file, `std/` in a workspace folder, `std/` next to the compiler's build directory.
 */
export function findStdRoot(filePath?: string, compilerPath?: string): string | undefined {
  const configured = vscode.workspace.getConfiguration("xlang").get<string>("stdPath", "").trim();
  if (configured && isStdRoot(configured)) {
    return path.normalize(configured);
  }

  const candidates: string[] = [];
  if (filePath) {
    let dir = path.dirname(filePath);
    for (let i = 0; i < 12; i += 1) {
      candidates.push(path.join(dir, "std"));
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(path.join(folder.uri.fsPath, "std"));
  }
  if (compilerPath && path.isAbsolute(compilerPath)) {
    const buildDir = path.dirname(compilerPath);
    candidates.push(path.join(buildDir, "..", "std"));
    candidates.push(path.join(buildDir, "..", "..", "std"));
  }

  for (const candidate of candidates) {
    const norm = path.normalize(candidate);
    if (isStdRoot(norm)) {
      return norm;
    }
  }
  return undefined;
}

/**
 * Resolves a module path the way the compiler does: `std` / `std/x` come from the stdlib root,
 * other paths from the importing file's directory. `"x"` is `x.xl` or `x/index.xl`.
 */
export function resolveModuleFile(
  modulePath: string,
  contextFile: string,
  stdRoot?: string
): string | undefined {
  const tryBase = (base: string, rel: string): string | undefined => {
    const direct = path.join(base, rel + SOURCE_EXT);
    if (isFile(direct)) {
      return direct;
    }
    const index = path.join(base, rel, "index" + SOURCE_EXT);
    if (isFile(index)) {
      return index;
    }
    return undefined;
  };

  if (modulePath === "std" || modulePath.startsWith("std/")) {
    if (!stdRoot) {
      return undefined;
    }
    const rel = modulePath === "std" ? "index" : modulePath.slice("std/".length);
    return tryBase(stdRoot, rel);
  }

  const here = tryBase(path.dirname(contextFile), modulePath);
  if (here) {
    return here;
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const found = tryBase(folder.uri.fsPath, modulePath);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** Module paths that can be typed in an import string, relative to `contextFile` or the stdlib. */
export function listModulePaths(contextFile: string, stdRoot?: string): string[] {
  const out = new Set<string>();

  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > 4 || !isDir(dir)) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "build") {
        continue;
      }
      if (entry.isDirectory()) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (isFile(path.join(dir, entry.name, "index" + SOURCE_EXT))) {
          out.add(rel);
        }
        walk(path.join(dir, entry.name), rel, depth + 1);
      } else if (entry.name.endsWith(SOURCE_EXT) && !entry.name.endsWith(TEST_SUFFIX)) {
        const stem = entry.name.slice(0, -SOURCE_EXT.length);
        if (stem !== "index") {
          out.add(prefix ? `${prefix}/${stem}` : stem);
        }
      }
    }
  };

  if (stdRoot) {
    out.add("std");
    walk(stdRoot, "std", 0);
  }
  const own = path.dirname(contextFile);
  walk(own, "", 2);
  out.delete(path.basename(contextFile, SOURCE_EXT));
  return [...out].sort();
}
