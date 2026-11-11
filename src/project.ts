// Project and package resolution for the editor. `xlc` knows nothing about manifests: the xlang
// tool reads `xlang.toml` / `xlang.lock`, finds every package under `.xlang/cache/` and hands them to
// the compiler as `-M <repository path>=<dir>`. This module does the same reading so IntelliSense,
// go-to-definition and the compiler calls of the extension agree with a real build.
//
// Rules mirrored from the package documentation (xlang-docs, "Packages"):
//   - the project root is the directory of the nearest `xlang.toml`, searched upward;
//   - a dependency is a repository path (`github.com/user/repo`) with a version, or a `path`;
//   - `latest` is pinned by `xlang.lock`; sources live in `<root>/.xlang/cache/<path>@<version>/`;
//   - `[std]` replaces the embedded standard library with a directory or a repository;
//   - one copy of each package per build, and the project's own `[dependencies]` win.

import * as fs from "node:fs";
import * as path from "node:path";
import { type TomlTable, isTable, parseToml } from "./toml";

export const MANIFEST_NAME = "xlang.toml";
export const LOCK_NAME = "xlang.lock";
export const CACHE_DIR = path.join(".xlang", "cache");

export interface Dependency {
  /** Repository path, the import path of the package: `github.com/user/repo`. */
  key: string;
  /** Exact tag or `latest`. Empty for a `path` dependency. */
  version: string;
  /** Directory of a local dependency, resolved against the manifest's directory. */
  dir?: string;
}

export interface StdSpec {
  /** Repository path of a downloaded stdlib. */
  repository?: string;
  version?: string;
  /** A local stdlib directory, resolved against the manifest's directory. */
  dir?: string;
}

export interface Manifest {
  file: string;
  dir: string;
  name?: string;
  dependencies: Dependency[];
  std?: StdSpec;
}

/** One `-M NAME=DIR` pair: `import "NAME"` and `import "NAME/sub"` resolve inside `dir`. */
export interface ModuleRoot {
  name: string;
  dir: string;
}

export interface Project {
  manifest: Manifest;
  /** Every dependency package that is on disk, the project's own first. */
  roots: ModuleRoot[];
  /** The stdlib named by `[std]`, when it is on disk. */
  stdRoot?: string;
  /** Repository paths (and `std`) that the manifest needs but the cache lacks. */
  missing: string[];
}

interface LockEntry {
  path: string;
  version: string;
  std: boolean;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function readTable(file: string): TomlTable | undefined {
  try {
    return parseToml(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The directory of the nearest `xlang.toml` at or above `fromDir`. */
export function findManifestDir(fromDir: string): string | undefined {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, MANIFEST_NAME))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export function loadManifest(file: string): Manifest | undefined {
  const table = readTable(file);
  if (!table) {
    return undefined;
  }
  const dir = path.dirname(file);
  const dependencies: Dependency[] = [];
  const deps = table.dependencies;
  if (isTable(deps)) {
    for (const [key, value] of Object.entries(deps)) {
      if (typeof value === "string") {
        dependencies.push({ key, version: value });
      } else if (isTable(value)) {
        const local = text(value.path);
        dependencies.push(
          local
            ? { key, version: "", dir: path.resolve(dir, local) }
            : { key, version: text(value.version) || "latest" }
        );
      }
    }
  }
  let std: StdSpec | undefined;
  if (isTable(table.std)) {
    const local = text(table.std.path);
    std = {
      repository: text(table.std.package) || undefined,
      version: text(table.std.version) || undefined,
      dir: local ? path.resolve(dir, local) : undefined,
    };
  }
  const pkg = table.package;
  return { file, dir, name: isTable(pkg) ? text(pkg.name) || undefined : undefined, dependencies, std };
}

function loadLock(dir: string): LockEntry[] {
  const list = readTable(path.join(dir, LOCK_NAME))?.package;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter(isTable).map((t) => ({
    path: text(t.path),
    version: text(t.version),
    std: t.std === true,
  }));
}

const cache = new Map<string, { stamp: string; project: Project }>();

export function resetProjectCache(): void {
  cache.clear();
}

function stamp(dir: string): string {
  const mtime = (name: string) => {
    try {
      return fs.statSync(path.join(dir, name)).mtimeMs;
    } catch {
      return 0;
    }
  };
  return `${mtime(MANIFEST_NAME)}:${mtime(LOCK_NAME)}:${isDir(path.join(dir, CACHE_DIR)) ? 1 : 0}`;
}

/** The project that owns `filePath`, or undefined when no `xlang.toml` is above it. */
export function loadProject(filePath: string): Project | undefined {
  const dir = findManifestDir(path.dirname(filePath));
  if (!dir) {
    return undefined;
  }
  const key = stamp(dir);
  const hit = cache.get(dir);
  if (hit && hit.stamp === key) {
    return hit.project;
  }
  const manifest = loadManifest(path.join(dir, MANIFEST_NAME));
  if (!manifest) {
    return undefined;
  }
  const project = resolve(manifest);
  cache.set(dir, { stamp: key, project });
  return project;
}

function resolve(manifest: Manifest): Project {
  const lock = loadLock(manifest.dir);
  const cacheDir = path.join(manifest.dir, CACHE_DIR);
  const roots: ModuleRoot[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  const cached = (repository: string, version: string): string | undefined => {
    const dir = path.join(cacheDir, `${repository}@${version}`);
    return isDir(dir) ? dir : undefined;
  };
  const versionOf = (dep: Dependency): string =>
    dep.version === "latest" || dep.version === ""
      ? (lock.find((e) => e.path === dep.key && !e.std)?.version ?? "")
      : dep.version;

  // Breadth first: the project's own dependencies are visited first, so they win a conflict.
  const queue: Dependency[] = [...manifest.dependencies];
  while (queue.length > 0) {
    const dep = queue.shift()!;
    if (seen.has(dep.key)) {
      continue;
    }
    seen.add(dep.key);
    const dir = dep.dir ?? (versionOf(dep) ? cached(dep.key, versionOf(dep)) : undefined);
    if (!dir || !isDir(dir)) {
      missing.push(dep.key);
      continue;
    }
    roots.push({ name: dep.key, dir });
    // A package lists its own dependencies in its own manifest; local ones are relative to it.
    const inner = loadManifest(path.join(dir, MANIFEST_NAME));
    queue.push(...(inner?.dependencies ?? []));
  }

  let stdRoot: string | undefined;
  const std = manifest.std;
  if (std?.dir) {
    stdRoot = isDir(std.dir) ? std.dir : undefined;
  } else if (std?.repository) {
    const version = std.version ?? lock.find((e) => e.std && e.path === std.repository)?.version ?? "";
    stdRoot = version ? cached(std.repository, version) : undefined;
  }
  if (std && !stdRoot) {
    missing.push("std");
  }
  return { manifest, roots, stdRoot, missing };
}

/** The package (root) a file belongs to, for the module key of its declarations. */
export function rootOfFile(filePath: string, roots: ModuleRoot[]): ModuleRoot | undefined {
  const norm = path.normalize(filePath);
  return roots.find((r) => {
    const rel = path.relative(r.dir, norm);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}
