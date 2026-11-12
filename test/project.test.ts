import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CACHE_DIR, computeEnvironment, parseEnvironment, rootOfFile } from "../src/project";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "xl-vscode-test-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const at = (rel: string) => path.join(root, rel);
const write = (rel: string, text = "") => {
  const file = at(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const exe = process.platform === "win32" ? ".exe" : "";

// An installed toolchain: $XLANG_HOME/toolchain.toml names the tags, the compiler and the stdlib live under them.
const home = at("home");
write("home/toolchain.toml", `xlc = "v1.0.0"\nstd = "v1.2.2"\n`);
write(`home/xlc/v1.0.0/xlc${exe}`);
write("home/std/v1.2.2/index.xl");
const env = { XLANG_HOME: home };

test("outside a project: the active toolchain only", () => {
  const e = computeEnvironment(write("loose/main.xl"), { env });
  expect(e.project).toBe("");
  expect(e.xlc).toBe(path.join(home, "xlc", "v1.0.0", `xlc${exe}`));
  expect(e.xlcTag).toBe("v1.0.0");
  expect(e.std).toBe(path.join(home, "std", "v1.2.2"));
  expect(e.stdTag).toBe("v1.2.2");
  expect(e.arguments).toEqual(["-M", `std=${e.std}`, "--import", "std", "-DfeatureDefaultAllocator=true"]);
  expect(e.problem).toBeNull();
});

test("no toolchain installed is a problem", () => {
  const e = computeEnvironment(at("loose/main.xl"), { env: { XLANG_HOME: at("nowhere") } });
  expect(e.problem).toBe("no xlang compiler is installed");
});

test("lock entries, path dependencies, xlang.local.toml and the overrides", () => {
  write(
    "app/xlang.toml",
    `[package]
name = "example.com/me/app"

[dependencies]
"github.com/u/pinned" = "v1.2.0"
"github.com/u/missing" = "v9.9.9"
"example.org/me/local" = { path = "../local" }
`
  );
  write(
    "app/xlang.lock",
    `[[package]]
name = "github.com/u/pinned"
version = "v1.2.0"
commit = "abc"

[[package]]
name = "github.com/u/inner"
version = "v0.1.0"
commit = "def"
`
  );
  write("app/.xlang/cache/github.com/u/pinned@v1.2.0/index.xl");
  write("app/.xlang/cache/github.com/u/inner@v0.1.0/index.xl");
  write("local/index.xl");
  const main = write("app/src/main.xl");
  const cache = (name: string) => path.join(at("app"), CACHE_DIR, name);

  const e = computeEnvironment(main, { env });
  expect(e.project).toBe(at("app"));
  expect(e.modules).toEqual([
    { name: "example.org/me/local", dir: at("local") },
    { name: "github.com/u/pinned", dir: cache("github.com/u/pinned@v1.2.0") },
    { name: "github.com/u/inner", dir: cache("github.com/u/inner@v0.1.0") },
  ]);
  expect(e.missing).toEqual(["github.com/u/missing"]);
  expect(e.problem).toBe("github.com/u/missing is not installed");
  expect(rootOfFile(path.join(cache("github.com/u/inner@v0.1.0"), "x.xl"), e.modules)?.name).toBe("github.com/u/inner");

  // xlang.local.toml: a module checkout replaces a package (and satisfies a missing one), a compiler, a stdlib and flags.
  write("work/std/index.xl");
  write(`work/xlc${exe}`);
  write(
    "app/xlang.local.toml",
    `[toolchain]
xlc = "../work/xlc${exe}"
std = "../work/std"

[modules]
"github.com/u/missing" = "../work/missing"
"github.com/u/pinned" = "../work/pinned"

[build]
flags = ["-DdebugLog=true", "-O2"]
`
  );
  const local = computeEnvironment(main, { env });
  expect(local.xlc).toBe(at(`work/xlc${exe}`));
  expect(local.xlcTag).toBe("");
  expect(local.std).toBe(at("work/std"));
  expect(local.stdTag).toBe("");
  expect(local.modules.find((m) => m.name === "github.com/u/pinned")?.dir).toBe(at("work/pinned"));
  expect(local.modules.find((m) => m.name === "github.com/u/missing")?.dir).toBe(at("work/missing"));
  expect(local.missing).toEqual([]);
  expect(local.flags).toEqual(["-DdebugLog=true", "-O2"]);
  expect(local.arguments.slice(-2)).toEqual(["-DdebugLog=true", "-O2"]);
  expect(local.problem).toBeNull();

  // $XLANG_STD beats xlang.local.toml, and --std (the stdPath setting) beats both.
  write("other/index.xl");
  write("third/index.xl");
  expect(computeEnvironment(main, { env: { ...env, XLANG_STD: at("other") } }).std).toBe(at("other"));
  expect(computeEnvironment(main, { env: { ...env, XLANG_STD: at("other") }, std: at("third") }).std).toBe(at("third"));
  // A stdlib without index.xl is reported.
  expect(computeEnvironment(main, { env, std: at("local/none") }).problem).toContain("is not a stdlib");
});

test("parses xl env --json and rejects anything else", () => {
  const json = JSON.stringify({
    file: "/p/main.xl",
    project: "/p",
    xlc: "/h/xlc",
    xlcTag: "v1.0.0",
    std: "/h/std",
    stdTag: "v1.2.2",
    modules: [{ name: "github.com/u/a", dir: "/p/.xlang/cache/github.com/u/a@v1.0.0" }, { name: 3 }],
    flags: ["-O2"],
    arguments: ["-M", "std=/h/std"],
    missing: [],
    problem: null,
  });
  const e = parseEnvironment(json)!;
  expect(e.modules).toEqual([{ name: "github.com/u/a", dir: "/p/.xlang/cache/github.com/u/a@v1.0.0" }]);
  expect(e.flags).toEqual(["-O2"]);
  expect(e.problem).toBeNull();
  expect(parseEnvironment("error[E0790]: no toolchain")).toBeUndefined();
  expect(parseEnvironment(`{"xlc": 1}`)).toBeUndefined();
});
