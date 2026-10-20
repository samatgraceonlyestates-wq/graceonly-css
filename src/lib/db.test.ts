// db.ts itself: configuration handling, pool settings, type parsing, and one REAL
// pg failure (a closed local port) to prove a genuine driver error is contained.
// No database is needed or contacted: the only socket opened is a refused
// connection to 127.0.0.1. Run: npm test
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { after, describe, it } from "node:test";
import { closeDb, DbError, POOL_SETTINGS, POOL_TYPES, query, sql, transaction } from "./db.ts";

const POOL_KEY = Symbol.for("graceonly-css.db.pool");
const CANARIES = ["canaryuser", "canarypass", "canarydb", "canary-host"];

async function withEnv<T>(value: string | undefined, work: () => Promise<T>): Promise<T> {
  const before = process.env.DATABASE_URL;
  if (value === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = value;
  try {
    return await work();
  } finally {
    if (before === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before;
  }
}

async function captureLog<T>(work: () => Promise<T>): Promise<{ lines: string[]; value: T }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { lines, value: await work() };
  } finally {
    console.error = original;
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected a rejection");
}

function everything(error: unknown, lines: string[]): string {
  assert.ok(error instanceof Error);
  return [error.message, error.stack ?? "", String(error), JSON.stringify(error), inspect(error, { depth: 8, showHidden: true }), ...lines].join("\n");
}

after(async () => {
  await closeDb();
});

describe("pool settings (shared cPanel PostgreSQL: small on purpose)", () => {
  it("is five connections or fewer", () => {
    assert.equal(POOL_SETTINGS.max, 5);
  });

  it("has a connection timeout, an idle timeout and server-side limits", () => {
    assert.ok(POOL_SETTINGS.connectionTimeoutMillis > 0 && POOL_SETTINGS.connectionTimeoutMillis <= 10_000);
    assert.ok(POOL_SETTINGS.idleTimeoutMillis > 0 && POOL_SETTINGS.idleTimeoutMillis <= 30_000);
    assert.ok(POOL_SETTINGS.statement_timeout > 0);
    assert.ok(POOL_SETTINGS.idle_in_transaction_session_timeout > 0);
    assert.ok(POOL_SETTINGS.query_timeout > POOL_SETTINGS.statement_timeout, "the client backstop outlasts the server limit");
  });

  it("names the application to the server", () => {
    assert.equal(POOL_SETTINGS.application_name, "graceonly-css");
  });
});

describe("value parsing", () => {
  it("returns a date as the string the database sent, not a Date (no local-midnight shift)", () => {
    const parse = POOL_TYPES.getTypeParser(1082, "text") as (value: string) => unknown;
    assert.equal(parse("2026-10-16"), "2026-10-16");
  });

  it("still returns timestamptz as an instant and integers as numbers", () => {
    const timestamptz = POOL_TYPES.getTypeParser(1184, "text") as (value: string) => unknown;
    const parsed = timestamptz("2026-10-16 08:00:00+01");
    assert.ok(parsed instanceof Date);
    assert.equal((parsed as Date).toISOString(), "2026-10-16T07:00:00.000Z");
    const int4 = POOL_TYPES.getTypeParser(23, "text") as (value: string) => unknown;
    assert.equal(int4("42"), 42);
  });
});

describe("configuration", () => {
  it("a missing DATABASE_URL is a 'config' DbError, and nothing is sent", async () => {
    await withEnv(undefined, async () => {
      const { lines, value } = await captureLog(() => rejection(query(sql`SELECT 1`)));
      assert.ok(value instanceof DbError);
      assert.equal(value.kind, "config");
      assert.equal(value.message, "The database is not set up for this application.");
      assert.equal(lines.length, 1);
      assert.equal((globalThis as Record<symbol, unknown>)[POOL_KEY], undefined, "no pool was created");
    });
  });

  it("a malformed DATABASE_URL is a 'config' DbError that does not echo it", async () => {
    // No scheme, so it is refused before anything is parsed or connected.
    await withEnv("canaryuser:canarypass@canary-host:5432/canarydb", async () => {
      for (const attempt of [() => query(sql`SELECT 1`), () => transaction(async () => 1)]) {
        const { lines, value } = await captureLog(() => rejection(attempt()));
        assert.ok(value instanceof DbError);
        assert.equal(value.kind, "config");
        const text = everything(value, lines);
        for (const secret of CANARIES) assert.ok(!text.includes(secret), `leaked ${secret}`);
      }
      assert.equal((globalThis as Record<symbol, unknown>)[POOL_KEY], undefined);
    });
  });

  it("an empty or blank DATABASE_URL is refused the same way", async () => {
    for (const value of ["", "   "]) {
      await withEnv(value, async () => {
        const error = await rejection(query(sql`SELECT 1`));
        assert.ok(error instanceof DbError);
        assert.equal(error.kind, "config");
      });
    }
  });
});

describe("a real pg failure is contained (a closed local port; no database involved)", () => {
  const URL_WITH_SECRETS = "postgresql://canaryuser:canarypass@127.0.0.1:1/canarydb";

  it("query(): a DbError, no connection detail in it or in the log, one pool", async () => {
    await withEnv(URL_WITH_SECRETS, async () => {
      const first = await captureLog(() => rejection(query(sql`SELECT 1`)));
      assert.ok(first.value instanceof DbError);
      assert.ok(first.value.kind === "unavailable" || first.value.kind === "timeout", first.value.kind);
      assert.equal(first.lines.length, 1, "logged once");
      const entry = JSON.parse(first.lines[0] ?? "{}") as Record<string, unknown>;
      assert.deepEqual(Object.keys(entry).filter((key) => !["event", "errorId", "kind", "sqlstate", "constraint", "table"].includes(key)), []);
      const text = everything(first.value, first.lines);
      for (const secret of [...CANARIES, "127.0.0.1"]) assert.ok(!text.includes(secret), `leaked ${secret}`);

      const pool = (globalThis as Record<symbol, unknown>)[POOL_KEY];
      assert.ok(pool !== undefined, "a pool exists");
      await captureLog(() => rejection(query(sql`SELECT 2`)));
      assert.equal((globalThis as Record<symbol, unknown>)[POOL_KEY], pool, "the second call reused the same pool");
    });
    await closeDb();
    assert.equal((globalThis as Record<symbol, unknown>)[POOL_KEY], undefined);
  });

  it("transaction(): the same", async () => {
    await withEnv(URL_WITH_SECRETS, async () => {
      const { lines, value } = await captureLog(() => rejection(transaction(async (tx) => void (await tx.query(sql`SELECT 1`)))));
      assert.ok(value instanceof DbError);
      assert.ok(value.kind === "unavailable" || value.kind === "timeout", value.kind);
      const text = everything(value, lines);
      for (const secret of [...CANARIES, "127.0.0.1"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
    });
    await closeDb();
  });

  it("closeDb() can be called when there is no pool", async () => {
    await closeDb();
    await closeDb();
  });
});
