// One build environment per project, asked of the xl tool: `xl env --json [--std=<dir>] <file>` prints the compiler, stdlib, module
// roots and flags a build of the file uses (xlang-docs compiler/cli.md "xl env"), so the editor resolves imports and calls xlc exactly
// as `xl build` does. When xl is missing or fails, computeEnvironment (project.ts) reads the same files itself.
//
// The answer is cached per project directory (per file directory outside a project) and recomputed when xlang.toml, xlang.lock,
// xlang.local.toml, the package cache, the active toolchain or $XLC / $XLANG_STD / $XLANG_HOME change. No vscode import: bun test
// covers it.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { type BuildEnvironment, computeEnvironment, environmentStamp, findManifestDir, parseEnvironment } from "./project";

export interface EnvironmentRequest {
  /** The xl binary; empty skips it and computes the environment locally. */
  cli: string;
  /** `--std=<dir>` (the `xlang.stdPath` setting); empty for none. */
  std: string;
}

export interface ResolvedEnvironment extends BuildEnvironment {
  /** `xl` when the xl tool answered, `editor` when the extension computed it. */
  source: "xl" | "editor";
}

const cache = new Map<string, { stamp: string; value: ResolvedEnvironment }>();
/** xl binaries that could not be started; not tried again until reset. */
const unavailable = new Set<string>();

export function resetEnvironmentCache(): void {
  cache.clear();
  unavailable.clear();
}

/** Asks xl; undefined when it cannot be started, fails or prints something else. */
function askXl(cli: string, file: string, std: string): BuildEnvironment | undefined {
  if (!cli || unavailable.has(cli) || !fs.existsSync(file)) {
    return undefined;
  }
  const args = ["env", "--json", ...(std ? [`--std=${std}`] : []), file];
  const result = spawnSync(cli, args, { cwd: path.dirname(file), encoding: "utf8", timeout: 5000, windowsHide: true });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      unavailable.add(cli);
    }
    return undefined;
  }
  return result.status === 0 ? parseEnvironment(result.stdout.trim()) : undefined;
}

/** The build environment of `file`. */
export function environmentOf(file: string, request: EnvironmentRequest): ResolvedEnvironment {
  const project = findManifestDir(path.dirname(path.resolve(file))) ?? "";
  const key = `${request.cli}\0${request.std}\0${project || path.dirname(path.resolve(file))}`;
  const stamp = environmentStamp(project);
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) {
    return hit.value;
  }
  const asked = askXl(request.cli, path.resolve(file), request.std);
  const value: ResolvedEnvironment = asked
    ? { ...asked, source: "xl" }
    : { ...computeEnvironment(file, { std: request.std || undefined }), source: "editor" };
  cache.set(key, { stamp, value });
  return value;
}
