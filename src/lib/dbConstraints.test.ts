// Proves dbConstraints.ts classifies EVERY constraint, unique index and primary
// key in db/migrations/, by deriving the list from the SQL files themselves. No
// database. A new migration that adds a constraint without a decision here fails
// this test. Run: npm test
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONSTRAINT_RULES, NOT_NULL_RULES, UNTRIPPABLE_CONSTRAINTS } from "./dbConstraints.ts";
import { deriveConstraints } from "./migrationConstraints.ts";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "migrations");
const derived = deriveConstraints(migrationsDir);

const mapped = new Set(Object.keys(CONSTRAINT_RULES));
const untrippable = new Set(Object.keys(UNTRIPPABLE_CONSTRAINTS));

describe("the derivation understands the migrations", () => {
  it("found a sensible amount, so an empty parse cannot pass", () => {
    assert.ok(derived.tables.length >= 22, `tables: ${derived.tables.length}`);
    assert.ok(derived.names.size >= 100, `names: ${derived.names.size}`);
  });

  it("accounts for every CHECK, UNIQUE, FOREIGN KEY, REFERENCES and PRIMARY KEY it sees", () => {
    // A non-empty list means a construct it does not understand, or an unnamed
    // constraint (CLAUDE.md: every CHECK, UNIQUE and composite FK is named).
    assert.deepEqual(derived.problems, []);
  });

  it("every name fits in 63 characters, so PostgreSQL does not truncate it", () => {
    for (const name of derived.names.keys()) assert.ok(name.length <= 63, `${name} is ${name.length}`);
  });
});

describe("every constraint is classified exactly once", () => {
  it("nothing in the migrations is missing from dbConstraints.ts", () => {
    const missing = [...derived.names.keys()].filter((name) => !mapped.has(name) && !untrippable.has(name)).sort();
    assert.deepEqual(missing, [], `Decide each: user can trip it (CONSTRAINT_RULES) or cannot (UNTRIPPABLE_CONSTRAINTS, with a reason).`);
  });

  it("nothing in dbConstraints.ts is stale (no longer in the migrations)", () => {
    const stale = [...mapped, ...untrippable].filter((name) => !derived.names.has(name)).sort();
    assert.deepEqual(stale, []);
  });

  it("nothing is in both tables", () => {
    const both = [...mapped].filter((name) => untrippable.has(name));
    assert.deepEqual(both, []);
  });

  it("a rule's kind matches the violation the constraint raises", () => {
    for (const [name, rule] of Object.entries(CONSTRAINT_RULES)) {
      assert.equal(rule.kind, derived.names.get(name), name);
    }
  });

  it("the counts add up", () => {
    assert.equal(mapped.size + untrippable.size, derived.names.size);
  });
});

describe("the entries themselves", () => {
  it("every untrippable constraint says why, in a real sentence", () => {
    for (const [name, reason] of Object.entries(UNTRIPPABLE_CONSTRAINTS)) {
      assert.ok(reason.length >= 30, `${name}: reason too short`);
      assert.match(reason, /[.)]$/, `${name}: reason should end like a sentence`);
    }
  });

  it("every mapped message is a sentence and every field is snake_case", () => {
    for (const [name, rule] of Object.entries(CONSTRAINT_RULES)) {
      assert.match(rule.message, /^[A-Z].*\.$/, name);
      if (rule.field !== null) assert.match(rule.field, /^[a-z][a-z0-9_]*$/, name);
    }
  });
});

// ---- NOT NULL: keyed table.column, checked against the CREATE TABLE text ----

function columnLines(table: string): string[] {
  let found: string[] = [];
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(migrationsDir, file), "utf8").replace(/--.*$/gm, "");
    const block = new RegExp(`CREATE\\s+TABLE\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\);`).exec(sql);
    if (block?.[1] !== undefined) found = found.concat(block[1].split("\n"));
  }
  return found;
}

describe("NOT NULL rules point at real NOT NULL columns", () => {
  for (const key of Object.keys(NOT_NULL_RULES)) {
    it(key, () => {
      const [table, column] = key.split(".");
      assert.ok(table !== undefined && column !== undefined, key);
      assert.ok(derived.tables.includes(table), `no table ${table}`);
      const line = columnLines(table).find((candidate) => new RegExp(`^\\s+${column}\\s`).test(candidate));
      assert.ok(line !== undefined, `no column ${key}`);
      assert.match(line, /NOT NULL|PRIMARY KEY/, `${key} is not NOT NULL`);
    });
  }

  it("every message is a sentence and every field is snake_case", () => {
    for (const [key, rule] of Object.entries(NOT_NULL_RULES)) {
      assert.match(rule.message, /^[A-Z].*\.$/, key);
      assert.match(rule.field, /^[a-z][a-z0-9_]*$/, key);
    }
  });
});
