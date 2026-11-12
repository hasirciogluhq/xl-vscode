// The build environment of a source file: the compiler, the stdlib, the package module roots and the extra compiler flags, exactly as
// the xl tool hands them to `xlc`. `xl env --json <file>` is the source of truth (environment.ts asks it first); this module is the
// same computation in TypeScript (xl's src/build/setup.xl), used when xl is not installed. Keep both in step with xlang-docs
// (compiler/cli.md "xl env", compiler/packages.md).
//
// Each layer replaces what it names, lowest first:
//   1. the active toolchain: `$XLANG_HOME/toolchain.toml` (`xlc = "<tag>"`, `std = "<tag>"`), the compiler at
//      `$XLANG_HOME/xlc/<tag>/xlc` and the stdlib at `$XLANG_HOME/std/<tag>` (`$XLANG_HOME` defaults to `~/.xlang`);
//   2. `xlang.toml` (the nearest one above the file): each `path` dependency maps to its directory, each `xlang.lock` entry
//      (`name`, `version`) to `<project>/.xlang/cache/<name>@<version>`; a package not on disk is listed in `missing`;
//   3. `xlang.local.toml` next to it: `[toolchain] xlc/std`, `[modules] "<name>" = "<dir>"`, `[build] flags = [...]`;
//   4. `$XLC` and `$XLANG_STD`;
//   5. `--std=<dir>` (the editor's `xlang.stdPath` setting).
// Paths that start with `./` or `../` are relative to the project directory.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type TomlTable, isTable, parseToml } from "./toml";

export const MANIFEST_NAME = "xlang.toml";
export const LOCK_NAME = "xlang.lock";
export const LOCAL_NAME = "xlang.local.toml";
export const CACHE_DIR = path.join(".xlang", "cache");

const EXE = process.platform === "win32" ? ".exe" : "";

/** One `-M NAME=DIR` pair: `import "NAME"` and `import "NAME/sub"` resolve inside `dir`. */
export interface ModuleRoot {
  name: string;
  dir: string;
}

/** The object `xl env --json` prints. */
export interface BuildEnvironment {
  file: string;
  /** Directory of `xlang.toml`; empty outside a project. */
  project: string;
  xlc: string;
  /** The toolchain tag of the compiler; empty when an override chose it. */
  xlcTag: string;
  std: string;
  stdTag: string;
  /** Package module roots, `std` not included. */
  modules: ModuleRoot[];
  /** `[build] flags` of `xlang.local.toml`. */
  flags: string[];
  /** Every xlc argument but the file: the stdlib, `--import std`, its features, the modules, the flags. */
  arguments: string[];
  /** Packages the manifest needs but the cache lacks. */
  missing: string[];
  /** Why a build cannot start (no compiler, no stdlib, a missing package), or null. */
  problem: string | null;
}

export interface Dependency {
  /** Repository path, the import path of the package: `github.com/user/repo`. */
  key: string;
  /** Tag or `latest`; empty for a `path` dependency. */
  version: string;
  /** Directory of a `path` dependency, as `relative` resolves it. */
  dir?: string;
}

export interface Manifest {
  file: string;
  dir: string;
  dependencies: Dependency[];
}

export interface LockEntry {
  name: string;
  version: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function readTable(file: string): TomlTable | undefined {
  try {
    return parseToml(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** `p` against `base` when it starts with `./` or `../`; anything else (absolute, a URL) as written. */
export const relative = (base: string, p: string): string =>
  p.startsWith("./") || p.startsWith("../") ? path.resolve(base, p) : p;

/** The directory of the nearest `xlang.toml` at or above `fromDir`. */
export function findManifestDir(fromDir: string): string | undefined {
  for (let dir = path.resolve(fromDir); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, MANIFEST_NAME))) {
      return dir;
    }
    if (path.dirname(dir) === dir) {
      return undefined;
    }
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
        dependencies.push(local ? { key, version: "", dir: relative(dir, local) } : { key, version: text(value.version) || "latest" });
      }
    }
  }
  return { file, dir, dependencies };
}

export function loadLock(dir: string): LockEntry[] {
  const list = readTable(path.join(dir, LOCK_NAME))?.package;
  return Array.isArray(list) ? list.filter(isTable).map((t) => ({ name: text(t.name), version: text(t.version) })) : [];
}

/** `$XLANG_HOME`, else `~/.xlang`. */
export const xlangHome = (env: NodeJS.ProcessEnv = process.env): string => env.XLANG_HOME || path.join(os.homedir(), ".xlang");

/** The active toolchain of toolchain.toml as paths (layer 1). */
function activeToolchain(env: NodeJS.ProcessEnv) {
  const home = xlangHome(env);
  const table = readTable(path.join(home, "toolchain.toml")) ?? {};
  const xlcTag = text(table.xlc);
  const stdTag = text(table.std);
  return {
    xlcTag,
    stdTag,
    xlc: xlcTag ? path.join(home, "xlc", xlcTag, "xlc" + EXE) : "",
    std: stdTag ? path.join(home, "std", stdTag) : "",
  };
}

export interface EnvironmentOptions {
  /** `--std=<dir>`: replaces the stdlib when not empty. */
  std?: string;
  env?: NodeJS.ProcessEnv;
}

/** The build environment of `file`, computed the way `xl env --json` computes it. */
export function computeEnvironment(file: string, options: EnvironmentOptions = {}): BuildEnvironment {
  const env = options.env ?? process.env;
  let tools = activeToolchain(env);
  const replace = (xlc: string, std: string) => {
    if (xlc) {
      tools = { ...tools, xlc, xlcTag: "" };
    }
    if (std) {
      tools = { ...tools, std, stdTag: "" };
    }
  };
  const modules: ModuleRoot[] = [];
  const flags: string[] = [];
  let missing: string[] = [];
  const map = (name: string, dir: string) => {
    const found = modules.find((m) => m.name === name);
    if (found) {
      found.dir = dir;
    } else {
      modules.push({ name, dir });
    }
  };

  const project = findManifestDir(path.dirname(path.resolve(file))) ?? "";
  const manifest = project ? loadManifest(path.join(project, MANIFEST_NAME)) : undefined;
  if (manifest) {
    const lock = loadLock(project);
    for (const dep of manifest.dependencies) {
      if (dep.dir) {
        map(dep.key, dep.dir);
      } else if (!lock.some((e) => e.name === dep.key)) {
        missing.push(dep.key);
      }
    }
    for (const entry of lock) {
      const dir = path.join(project, CACHE_DIR, `${entry.name}@${entry.version}`);
      if (isDir(dir)) {
        map(entry.name, dir);
      } else {
        missing.push(entry.name);
      }
    }
    const local = readTable(path.join(project, LOCAL_NAME));
    if (local) {
      if (isTable(local.toolchain)) {
        replace(relative(project, text(local.toolchain.xlc)), relative(project, text(local.toolchain.std)));
      }
      if (isTable(local.modules)) {
        for (const [name, dir] of Object.entries(local.modules)) {
          if (typeof dir === "string") {
            map(name, relative(project, dir));
            missing = missing.filter((m) => m !== name);
          }
        }
      }
      if (isTable(local.build) && Array.isArray(local.build.flags)) {
        flags.push(...local.build.flags.filter((f): f is string => typeof f === "string"));
      }
    }
  }
  replace(env.XLC ?? "", env.XLANG_STD ?? "");
  replace("", options.std ?? "");

  const args = ["-M", `std=${tools.std}`, "--import", "std", "-DfeatureDefaultAllocator=true"];
  for (const m of modules) {
    args.push("-M", `${m.name}=${m.dir}`);
  }
  args.push(...flags);

  let problem: string | null = null;
  if (!tools.xlc || !fs.existsSync(tools.xlc)) {
    problem = tools.xlc ? `the compiler ${tools.xlc} does not exist` : "no xlang compiler is installed";
  } else if (!tools.std || !fs.existsSync(path.join(tools.std, "index.xl"))) {
    problem = tools.std ? `${tools.std} is not a stdlib (it has no index.xl)` : "no xlang stdlib is installed";
  } else if (missing.length > 0) {
    problem = `${missing[0]} is not installed`;
  }
  return { file: path.resolve(file), project, ...tools, modules, flags, arguments: args, missing, problem };
}

/** The `xl env --json` output as a BuildEnvironment, or undefined when it is not one. */
export function parseEnvironment(json: string): BuildEnvironment | undefined {
  try {
    const v = JSON.parse(json) as Partial<BuildEnvironment>;
    if (typeof v.xlc !== "string" || typeof v.std !== "string" || !Array.isArray(v.modules) || !Array.isArray(v.arguments)) {
      return undefined;
    }
    return {
      file: text(v.file),
      project: text(v.project),
      xlc: v.xlc,
      xlcTag: text(v.xlcTag),
      std: v.std,
      stdTag: text(v.stdTag),
      modules: v.modules.filter((m) => typeof m?.name === "string" && typeof m?.dir === "string"),
      flags: Array.isArray(v.flags) ? v.flags.filter((f) => typeof f === "string") : [],
      arguments: v.arguments.filter((a) => typeof a === "string"),
      missing: Array.isArray(v.missing) ? v.missing.filter((m) => typeof m === "string") : [],
      problem: typeof v.problem === "string" ? v.problem : null,
    };
  } catch {
    return undefined;
  }
}

/** What a cached environment depends on: the project files, the toolchain choice and the overriding variables. */
export function environmentStamp(project: string, env: NodeJS.ProcessEnv = process.env): string {
  const mtime = (file: string) => {
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  };
  const files = project ? [MANIFEST_NAME, LOCK_NAME, LOCAL_NAME, CACHE_DIR].map((n) => mtime(path.join(project, n))) : [];
  return [...files, mtime(path.join(xlangHome(env), "toolchain.toml")), env.XLC ?? "", env.XLANG_STD ?? "", env.XLANG_HOME ?? ""].join(":");
}

/** The package (root) a file belongs to, for the module key of its declarations. */
export function rootOfFile(filePath: string, roots: ModuleRoot[]): ModuleRoot | undefined {
  const norm = path.normalize(filePath);
  return roots.find((r) => {
    const rel = path.relative(r.dir, norm);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}
