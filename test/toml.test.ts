import { expect, test } from "bun:test";
import { isTable, parseToml } from "../src/toml";

test("reads tables, quoted dotted keys and inline tables", () => {
  const t = parseToml(`
[package]
name = "myapp"          # informational

[dependencies]
"github.com/user/repo" = "v1.2.0"
"example.org/me/local" = { path = "../local" }
"git.example.org/team/lib" = { version = "v0.3.1", source = "git@git.example.org:team/lib.git" }
`);
  expect((t.package as { name: string }).name).toBe("myapp");
  const deps = t.dependencies;
  expect(isTable(deps) && deps["github.com/user/repo"]).toBe("v1.2.0");
  expect(isTable(deps) && (deps["example.org/me/local"] as { path: string }).path).toBe("../local");
  expect(isTable(deps) && (deps["git.example.org/team/lib"] as { version: string }).version).toBe("v0.3.1");
});

test("reads arrays of tables, multi-line arrays and booleans", () => {
  const t = parseToml(`
[[package]]
path = "github.com/a/b"
version = "v1.0.0"
std = true

[[package]]
path = "github.com/c/d"
version = "v2.0.0"

[[native]]
link = [
  "lib/a.a",
  "lib/b.a", # trailing comment
]
`);
  const list = t.package as { path: string; std?: boolean }[];
  expect(list.map((p) => p.path)).toEqual(["github.com/a/b", "github.com/c/d"]);
  expect(list[0].std).toBe(true);
  expect((t.native as { link: string[] }[])[0].link).toEqual(["lib/a.a", "lib/b.a"]);
});

test("skips a broken statement and keeps the rest", () => {
  const t = parseToml(`
a = "ok"
b = = nonsense
c = 3
`);
  expect(t.a).toBe("ok");
  expect(t.c).toBe(3);
});
