import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadProject, resetProjectCache, rootOfFile } from "../src/project";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "xl-vscode-test-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (rel: string, text = "") => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

test("resolves dependencies, the lock, path dependencies, transitive packages and [std]", () => {
  write(
    "app/xlang.toml",
    `[dependencies]
"github.com/u/pinned" = "v1.2.0"
"github.com/u/floating" = "latest"
"github.com/u/missing" = "v9.9.9"
"example.org/me/local" = { path = "../local" }

[std]
package = "github.com/u/std"
`
  );
  write(
    "app/xlang.lock",
    `[[package]]
path = "github.com/u/floating"
version = "v3.0.0"
commit = "abc"

[[package]]
path = "github.com/u/std"
version = "v0.4.0"
commit = "def"
std = true
`
  );
  write("app/.xlang/cache/github.com/u/pinned@v1.2.0/index.xl");
  write("app/.xlang/cache/github.com/u/pinned@v1.2.0/xlang.toml", `[dependencies]\n"github.com/u/inner" = "v0.1.0"\n`);
  write("app/.xlang/cache/github.com/u/inner@v0.1.0/index.xl");
  write("app/.xlang/cache/github.com/u/floating@v3.0.0/index.xl");
  write("app/.xlang/cache/github.com/u/std@v0.4.0/index.xl");
  write("local/index.xl");
  const main = write("app/src/main.xl");
  resetProjectCache();

  const project = loadProject(main)!;
  expect(project.manifest.dir).toBe(path.join(root, "app"));
  expect(project.roots.map((r) => r.name)).toEqual([
    "github.com/u/pinned",
    "github.com/u/floating",
    "example.org/me/local",
    "github.com/u/inner",
  ]);
  expect(project.roots.find((r) => r.name === "example.org/me/local")!.dir).toBe(path.join(root, "local"));
  expect(project.missing).toEqual(["github.com/u/missing"]);
  expect(project.stdRoot).toBe(path.join(root, "app", ".xlang", "cache", "github.com/u/std@v0.4.0"));
  expect(rootOfFile(path.join(root, "app/.xlang/cache/github.com/u/inner@v0.1.0/index.xl"), project.roots)?.name).toBe(
    "github.com/u/inner"
  );
});

test("a file with no xlang.toml above it has no project", () => {
  const lone = write("lone/main.xl");
  resetProjectCache();
  expect(loadProject(lone)).toBeUndefined();
});
