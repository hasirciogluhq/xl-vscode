// A reader for the TOML subset `xlang.toml` and `xlang.lock` use: tables, arrays of tables, bare,
// quoted and dotted keys, strings, integers, booleans, arrays and inline tables. Multi-line strings,
// floats and dates are not part of the subset. The reader is forgiving: a malformed statement is
// skipped, so a half-typed manifest still yields what is valid (the compiler tools report the rest).

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export const isTable = (value: TomlValue | undefined): value is TomlTable =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class Reader {
  i = 0;
  constructor(readonly text: string) {}

  get done(): boolean {
    return this.i >= this.text.length;
  }

  peek(offset = 0): string {
    return this.text[this.i + offset] ?? "";
  }

  /** Blanks and tabs only. */
  skipInline(): void {
    while (this.peek() === " " || this.peek() === "\t") {
      this.i += 1;
    }
  }

  /** Blanks, line breaks and `#` comments (between array items). */
  skipAll(): void {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.i += 1;
      } else if (c === "#") {
        this.skipLine();
      } else {
        return;
      }
    }
  }

  skipLine(): void {
    while (!this.done && this.peek() !== "\n") {
      this.i += 1;
    }
  }

  expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new SyntaxError(`expected ${ch}`);
    }
    this.i += 1;
  }

  string(): string {
    const quote = this.peek();
    this.i += 1;
    let out = "";
    for (;;) {
      const c = this.peek();
      if (this.done || c === "\n") {
        throw new SyntaxError("unterminated string");
      }
      this.i += 1;
      if (c === quote) {
        return out;
      }
      if (c === "\\" && quote === '"') {
        const e = this.peek();
        this.i += 1;
        out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
      } else {
        out += c;
      }
    }
  }

  /** One key segment: bare or quoted. */
  segment(): string {
    const c = this.peek();
    if (c === '"' || c === "'") {
      return this.string();
    }
    const m = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.i));
    if (!m) {
      throw new SyntaxError("expected a key");
    }
    this.i += m[0].length;
    return m[0];
  }

  /** A dotted key: `a.b."c.d"`. */
  key(): string[] {
    const parts = [this.segment()];
    this.skipInline();
    while (this.peek() === ".") {
      this.i += 1;
      this.skipInline();
      parts.push(this.segment());
      this.skipInline();
    }
    return parts;
  }

  value(): TomlValue {
    const c = this.peek();
    if (c === '"' || c === "'") {
      return this.string();
    }
    if (c === "[") {
      this.i += 1;
      const items: TomlValue[] = [];
      for (;;) {
        this.skipAll();
        if (this.peek() === "]") {
          this.i += 1;
          return items;
        }
        items.push(this.value());
        this.skipAll();
        if (this.peek() === ",") {
          this.i += 1;
        }
      }
    }
    if (c === "{") {
      this.i += 1;
      const table: TomlTable = {};
      for (;;) {
        this.skipInline();
        if (this.peek() === "}") {
          this.i += 1;
          return table;
        }
        const key = this.key();
        this.skipInline();
        this.expect("=");
        this.skipInline();
        assign(table, key, this.value());
        this.skipInline();
        if (this.peek() === ",") {
          this.i += 1;
        }
      }
    }
    const word = /^[A-Za-z0-9_+.-]+/.exec(this.text.slice(this.i))?.[0] ?? "";
    this.i += word.length;
    if (word === "true" || word === "false") {
      return word === "true";
    }
    if (/^[+-]?\d[\d_]*$/.test(word)) {
      return Number(word.replace(/_/g, ""));
    }
    throw new SyntaxError(`bad value ${word}`);
  }
}

/** Walks `path` below `root`, creating tables; the last element of an array of tables is entered. */
function descend(root: TomlTable, path: string[]): TomlTable {
  let table = root;
  for (const seg of path) {
    const next = table[seg];
    if (Array.isArray(next)) {
      const last = next[next.length - 1];
      table = isTable(last) ? last : (next[next.length - 1] = {});
    } else if (isTable(next)) {
      table = next;
    } else {
      table = table[seg] = {};
    }
  }
  return table;
}

function assign(table: TomlTable, key: string[], value: TomlValue): void {
  const last = key[key.length - 1];
  descend(table, key.slice(0, -1))[last] = value;
}

export function parseToml(text: string): TomlTable {
  const root: TomlTable = {};
  const r = new Reader(text);
  let current = root;

  while (!r.done) {
    r.skipAll();
    if (r.done) {
      break;
    }
    const start = r.i;
    try {
      if (r.peek() === "[") {
        const isArray = r.peek(1) === "[";
        r.i += isArray ? 2 : 1;
        r.skipInline();
        const path = r.key();
        r.skipInline();
        r.expect("]");
        if (isArray) {
          r.expect("]");
          const parent = descend(root, path.slice(0, -1));
          const name = path[path.length - 1];
          const list = Array.isArray(parent[name]) ? (parent[name] as TomlValue[]) : (parent[name] = []);
          const entry: TomlTable = {};
          list.push(entry);
          current = entry;
        } else {
          current = descend(root, path);
        }
      } else {
        const key = r.key();
        r.skipInline();
        r.expect("=");
        r.skipInline();
        assign(current, key, r.value());
      }
    } catch {
      if (r.i === start) {
        r.i += 1;
      }
    }
    r.skipLine();
  }
  return root;
}
