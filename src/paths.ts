import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { type ModuleRoot, findManifestDir, loadProject } from "./project";

export const SOURCE_EXT = ".xl";
export const TEST_SUFFIX = ".test.xl";
/** Directory name of the standard library checkout (the `xl-std` repository). */
export const STD_DIR = "xl-std";

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** A standard library root holds `index.xl`. */
const isStdRoot = (dir: string): boolean => isFile(path.join(dir, "index" + SOURCE_EXT));

export const isInside = (file: string, dir: string): boolean => {
  const rel = path.relative(dir, path.normalize(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Directories above `start` (nearest first), at most `limit` of them. */
function* ancestors(start: string, limit = 12): Generator<string> {
  let dir = path.resolve(start);
  for (let i = 0; i < limit; i += 1) {
    yield dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

/**
 * The standard library sources: `xlc` has none built in, the xlang tool passes `-M std=<dir>`.
 * First match wins: the `xlang.stdPath` setting, `[std]` of the project's `xlang.toml`, an `xl-std/`
 * checkout above the file, in a workspace folder or above the compiler binary, then `~/.xlang/std`.
 */
export function findStdRoot(filePath?: string, compilerPath?: string): string | undefined {
  const configured = vscode.workspace.getConfiguration("xlang").get<string>("stdPath", "").trim();
  if (configured && isStdRoot(configured)) {
    return path.normalize(configured);
  }

  if (filePath) {
    const std = loadProject(filePath)?.stdRoot;
    if (std && isStdRoot(std)) {
      return std;
    }
  }

  const bases: string[] = [];
  if (filePath) {
    bases.push(...ancestors(path.dirname(filePath)));
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    bases.push(folder.uri.fsPath);
  }
  if (compilerPath && path.isAbsolute(compilerPath)) {
    bases.push(...ancestors(path.dirname(compilerPath), 6));
  }
  const candidates = bases.map((base) => path.join(base, STD_DIR));
  candidates.push(path.join(os.homedir(), ".xlang", "std"));
  return candidates.map(path.normalize).find(isStdRoot);
}

export interface ModuleContext {
  /** Every `NAME=DIR` pair the compiler is given, the stdlib (`std`) included, longest name first. */
  roots: ModuleRoot[];
  stdRoot?: string;
  /** Directory of the project's `xlang.toml`. */
  projectDir?: string;
  /** Repository paths the manifest needs but `.xlang/cache` lacks. */
  missing: string[];
}

/** What `-M` would carry for `filePath`: the project's packages plus the standard library. */
export function moduleContext(filePath: string, compilerPath?: string): ModuleContext {
  const project = loadProject(filePath);
  const stdRoot = findStdRoot(filePath, compilerPath);
  const roots = [...(project?.roots ?? [])];
  if (stdRoot) {
    roots.push({ name: "std", dir: stdRoot });
  }
  roots.sort((a, b) => b.name.length - a.name.length);
  return {
    roots,
    stdRoot,
    projectDir: project?.manifest.dir ?? findManifestDir(path.dirname(filePath)),
    missing: project?.missing ?? [],
  };
}

/** The root an import specifier names: equal to a root name, or continuing it with `/`. */
export function rootOfSpec(spec: string, roots: ModuleRoot[]): { root: ModuleRoot; rest: string } | undefined {
  for (const root of roots) {
    if (spec === root.name) {
      return { root, rest: "" };
    }
    if (spec.startsWith(root.name + "/")) {
      return { root, rest: spec.slice(root.name.length + 1) };
    }
  }
  return undefined;
}

/** `x` is `x.xl` or `x/index.xl` below `base`. */
function tryBase(base: string, rel: string): string | undefined {
  const direct = path.join(base, rel + SOURCE_EXT);
  if (rel !== "" && isFile(direct)) {
    return direct;
  }
  const index = path.join(base, rel, "index" + SOURCE_EXT);
  return isFile(index) ? index : undefined;
}

/**
 * Resolves a module path the way the compiler does: a path under a module root (a package or `std`)
 * comes from that root; any other path is searched from the importing file's directory, then from
 * the project (or workspace) directory standing in for the root file's directory.
 */
export function resolveModuleFile(spec: string, contextFile: string, ctx: ModuleContext): string | undefined {
  const named = rootOfSpec(spec, ctx.roots);
  if (named) {
    return tryBase(named.root.dir, named.rest);
  }
  const bases = [path.dirname(contextFile)];
  if (ctx.projectDir) {
    bases.push(ctx.projectDir);
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    bases.push(folder.uri.fsPath);
  }
  for (const base of bases) {
    const found = tryBase(base, spec);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export interface ModuleEntry {
  path: string;
  /** `std`, a package repository path, or relative to the importing file. */
  origin: "std" | "package" | "local";
}

/** Module paths that can be typed in an import string. */
export function listModulePaths(contextFile: string, ctx: ModuleContext): ModuleEntry[] {
  const out = new Map<string, ModuleEntry["origin"]>();

  const walk = (dir: string, prefix: string, depth: number, origin: ModuleEntry["origin"]) => {
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
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (isFile(path.join(dir, entry.name, "index" + SOURCE_EXT))) {
          out.set(rel, origin);
        }
        walk(path.join(dir, entry.name), rel, depth + 1, origin);
      } else if (entry.name.endsWith(SOURCE_EXT) && !entry.name.endsWith(TEST_SUFFIX)) {
        const stem = entry.name.slice(0, -SOURCE_EXT.length);
        if (stem !== "index") {
          out.set(prefix ? `${prefix}/${stem}` : stem, origin);
        }
      }
    }
  };

  for (const root of ctx.roots) {
    const origin = root.name === "std" ? "std" : "package";
    if (isFile(path.join(root.dir, "index" + SOURCE_EXT))) {
      out.set(root.name, origin);
    }
    walk(root.dir, root.name, 0, origin);
  }
  walk(path.dirname(contextFile), "", 2, "local");
  out.delete(path.basename(contextFile, SOURCE_EXT));
  return [...out].map(([p, origin]) => ({ path: p, origin })).sort((a, b) => a.path.localeCompare(b.path));
}
