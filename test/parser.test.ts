import { expect, test } from "bun:test";
import { memberTypeName, moduleIdFromPath, parseXlangSource, splitTop } from "../src/parser";

const parse = (source: string) => parseXlangSource(source, "/p/main.xl", "main");

test("reads imports, re-exports and the forms of the module system", () => {
  const m = parse(`
import "std"
import "std/mem" as mem
from "std" import print, String as Str
import a, b from "github.com/u/r/sub"
import * from "x"
import * as sys from "std/sys"
export * from "memory" except strlen
export * as net from "net"
export { one, two as three } from "m"
`);
  expect(m.imports.map((i) => [i.kind, i.alias, i.modulePath])).toEqual([
    ["namespace", "std", "std"],
    ["namespace", "mem", "std/mem"],
    ["symbol", "print", "std"],
    ["symbol", "Str", "std"],
    ["symbol", "a", "github.com/u/r/sub"],
    ["symbol", "b", "github.com/u/r/sub"],
    ["star", "*", "x"],
    ["namespace", "sys", "std/sys"],
  ]);
  expect(m.reexports.map((r) => r.kind)).toEqual(["star", "namespace", "names"]);
  expect(m.reexports[0].except).toEqual(["strlen"]);
  expect(m.reexports[2].names).toEqual([
    { name: "one", alias: "one" },
    { name: "two", alias: "three" },
  ]);
});

test("reads generics, constants, aliases and payload enums", () => {
  const m = parse(`
/// Larger of two.
export fn max<T>(a: T, b: T) -> T { return a }
fn out = io.print
const LIMIT: i32 = 7
const GREETING = "hi"
type Pair<T> = (T, T)
struct Cell<T> { value: T, next: *Cell<T> }
class Dog : Animal<i32> {
    tail: i32
    fn init(self, n: i32) { }
}
enum Color: i32 { Red, Green = 5, Blue }
enum Expr {
    Num(i64)
    Add(*Expr, *Expr)
    Nil
}
enum Result<T, E> { Ok(T) Err(E) }
impl<T> Iter<T> for Cell<T> {
    fn next(self) -> T { return self.value }
}
`);
  const sig = (name: string) => m.symbols.find((s) => s.name === name)!;
  expect(sig("max").signature).toBe("fn max<T>(a: T, b: T) -> T");
  expect(sig("max").documentation).toBe("Larger of two.");
  expect(sig("out").detail).toBe("function alias");
  expect(sig("LIMIT").signature).toBe("const LIMIT: i32 = 7");
  expect(sig("GREETING").returnType).toBe("str");
  expect(sig("Pair").signature).toBe("type Pair<T> = (T, T)");
  expect(m.aggregates.get("Cell")!.fields.map((f) => f.name)).toEqual(["value", "next"]);
  expect(m.aggregates.get("Dog")!.base).toBe("Animal<i32>");
  expect(m.aggregates.get("Dog")!.methods.map((f) => f.name)).toEqual(["init"]);
  expect(m.aggregates.get("Color")!.members.map((e) => e.name)).toEqual(["Red", "Green", "Blue"]);
  expect(m.aggregates.get("Expr")!.members).toEqual([
    { name: "Num", payload: ["i64"], value: undefined },
    { name: "Add", payload: ["*Expr", "*Expr"], value: undefined },
    { name: "Nil", payload: undefined, value: undefined },
  ]);
  expect(m.aggregates.get("Result")!.members.map((e) => e.name)).toEqual(["Ok", "Err"]);
  expect(m.aggregates.get("Cell")!.methods.map((f) => f.name)).toEqual(["next"]);
});

test("collects locals of every form and ignores braces in byte literals and block comments", () => {
  const m = parse(`
fn divMod(a: i64, b: i64) -> (i64, i64) { return (a / b, a % b) }
enum Expr { Num(i64) Add(*Expr, *Expr) }
/* a block comment with a { brace
   over two lines } */
@entry fn main(argc: i32, argv: **u8) -> i32 {
    local a: i32 = 0
    local b := 3
    local c = b'{'
    local s := "text"
    local (q, r) = divMod(7, 3)
    const K = 9
    local buf: [i32; 4] = [1, 2, 3, 4]
    for x, i in buf { }
    for n in 0..10 { }
    for local j := 0; j < 3; j++ { }
    try { work() } catch e { }
    local e2 := Expr.Num(1)
    switch e2 {
        case Expr.Add(l, rr) { }
        case Expr.Num(v) { }
    }
    return 0
}
fn after() { }
`);
  const main = m.functions.find((f) => f.name === "main")!;
  const t = (n: string) => main.locals.find((l) => l.name === n)?.type;
  expect(main.params.map((p) => p.type)).toEqual(["i32", "**u8"]);
  expect(t("a")).toBe("i32");
  expect(t("b")).toBe("i32");
  expect(t("c")).toBe("u8");
  expect(t("s")).toBe("str");
  expect(t("q")).toBe("i64");
  expect(t("r")).toBe("i64");
  expect(t("K")).toBe("i32");
  expect(t("x")).toBe("*i32");
  expect(t("i")).toBe("usize");
  expect(t("n")).toBeDefined();
  expect(t("j")).toBe("i32");
  expect(t("e")).toBe("*u8");
  expect(t("l")).toBe("*Expr");
  expect(t("v")).toBe("i64");
  // The brace in `b'{'` and in the block comment must not move the end of the function.
  expect(m.functions.find((f) => f.name === "after")).toBeDefined();
  expect(main.endLine).toBeLessThan(m.functions.find((f) => f.name === "after")!.startLine);
});

test("constructor and struct-literal calls of types from other modules keep their type", () => {
  const m = parse(`
@entry fn main() -> i32 {
    local s := String()
    local v := Vec<i32>()
    local p := Point { x: 1 }
    local n := count()
    return 0
}
fn count() -> usize { return 0 }
`);
  const main = m.functions.find((f) => f.name === "main")!;
  const t = (n: string) => main.locals.find((l) => l.name === n)?.type;
  expect([t("s"), t("v"), t("p"), t("n")]).toEqual(["String", "Vec<i32>", "Point", "usize"]);
});

test("type names reduce to the type whose members a value exposes", () => {
  expect(memberTypeName("*String")).toBe("String");
  expect(memberTypeName("[Vec<i32>; 4]")).toBe("Vec");
  expect(memberTypeName("[]mut Point")).toBe("Point");
  expect(memberTypeName("mem.Allocator")).toBe("Allocator");
  expect(splitTop("a: Pair<i32, i32>, b: fn(i32) -> i32, c")).toEqual(["a: Pair<i32, i32>", "b: fn(i32) -> i32", "c"]);
});

test("module ids follow the -M roots, then the project directory", () => {
  const roots = [
    { name: "github.com/u/r", dir: "/c/github.com/u/r@v1" },
    { name: "std", dir: "/s" },
  ];
  expect(moduleIdFromPath("/s/mem/index.xl", roots)).toBe("std/mem");
  expect(moduleIdFromPath("/s/index.xl", roots)).toBe("std");
  expect(moduleIdFromPath("/c/github.com/u/r@v1/sub/x.xl", roots)).toBe("github.com/u/r/sub/x");
  expect(moduleIdFromPath("/app/src/util.xl", roots, "/app")).toBe("src/util");
  expect(moduleIdFromPath("/elsewhere/z.xl", roots, "/app")).toBe("z");
});
