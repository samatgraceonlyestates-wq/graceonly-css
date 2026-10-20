// query() and transaction() against a FAKE pool: no database, no network.
// Run: npm test
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, it } from "node:test";
import { createDb, sql, type ClientLike, type PoolLike, type Statement } from "./dbCore.ts";
import { DbError, type DbErrorLogEntry } from "./dbErrors.ts";

const CANARY_URL = "postgresql://canary_user:CANARYpw9f3a@db.canary-host.example:5432/canary_db";
const SECRETS = [CANARY_URL, "CANARYpw9f3a", "canary_user", "canary-host", "canary_db", "10.9.8.7", "CANARY-ROW-Amaka"];

function pgError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error(`${CANARY_URL} CANARY-ROW-Amaka`), {
    detail: "Key (client_name_logged)=(CANARY-ROW-Amaka) already exists.",
    hint: "CANARY-ROW-Amaka",
    where: "CANARY-ROW-Amaka",
    host: "db.canary-host.example",
    address: "10.9.8.7",
    user: "canary_user",
    severity: "ERROR",
    ...fields,
  });
}

function assertNoLeak(error: unknown, entries: DbErrorLogEntry[]): void {
  assert.ok(error instanceof Error);
  const text = [
    error.message,
    error.stack ?? "",
    String(error),
    JSON.stringify(error),
    inspect(error, { depth: 8, showHidden: true }),
    JSON.stringify(entries),
  ].join("\n");
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.equal((error as { cause?: unknown }).cause, undefined);
}

type Result = { rows: unknown[]; rowCount: number | null };
type Script = (text: string, values: readonly unknown[], via: "pool" | "client") => Result | undefined;

function harness(script: Script = () => undefined, connectError?: unknown) {
  const calls: { via: "pool" | "client"; text: string; values: readonly unknown[] }[] = [];
  const released: (boolean | undefined)[] = [];
  let connects = 0;
  const entries: DbErrorLogEntry[] = [];

  async function run(via: "pool" | "client", text: string, values: readonly unknown[]): Promise<Result> {
    calls.push({ via, text, values });
    return script(text, values, via) ?? { rows: [], rowCount: 0 };
  }
  const pool: PoolLike = {
    query: (text, values) => run("pool", text, values),
    async connect(): Promise<ClientLike> {
      connects += 1;
      if (connectError !== undefined) throw connectError;
      return { query: (text, values) => run("client", text, values), release: (destroy) => void released.push(destroy) };
    },
  };
  const db = createDb(() => pool, { log: (entry) => void entries.push(entry), newId: () => "E-FAKE" });
  return { db, calls, released, entries, connects: () => connects };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected a rejection");
}

describe("sql`` builds parameterized statements", () => {
  it("numbers the placeholders and keeps the values apart", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const statement = sql`SELECT * FROM visit WHERE id = ${id} AND reason_code = ${"INQUIRY"}`;
    assert.equal(statement.text, "SELECT * FROM visit WHERE id = $1 AND reason_code = $2");
    assert.deepEqual([...statement.values], [id, "INQUIRY"]);
  });

  it("a hostile value stays data and never reaches the SQL text", () => {
    const evil = "x'; DROP TABLE visit; --";
    const statement = sql`SELECT 1 FROM visitor WHERE display_name = ${evil}`;
    assert.ok(!statement.text.includes("DROP"));
    assert.equal(statement.text, "SELECT 1 FROM visitor WHERE display_name = $1");
    assert.equal(statement.values[0], evil);
  });

  it("takes strings, numbers, booleans, null, dates, bigints, bytes and arrays", () => {
    const when = new Date("2026-10-16T08:00:00Z");
    const statement = sql`SELECT ${"a"}, ${1}, ${true}, ${null}, ${when}, ${BigInt(10)}, ${new Uint8Array([1])}, ${["x", "y"]}`;
    assert.equal(statement.values.length, 8);
    assert.equal(statement.values[4], when);
  });

  it("works with no parameters", () => {
    const statement = sql`SELECT 1`;
    assert.equal(statement.text, "SELECT 1");
    assert.equal(statement.values.length, 0);
  });

  it("refuses undefined (pass null for NULL)", () => {
    assert.throws(() => sql`SELECT ${undefined as unknown as null}`, TypeError);
  });

  it("refuses a statement nested in another", () => {
    assert.throws(() => sql`SELECT ${sql`1` as unknown as string}`, TypeError);
  });

  it("refuses a hand-written $1 beside ${} placeholders", () => {
    assert.throws(() => sql`SELECT $1, ${"a"}`, TypeError);
  });

  it("is frozen", () => {
    const statement = sql`SELECT ${"a"}`;
    assert.ok(Object.isFrozen(statement));
    assert.ok(Object.isFrozen(statement.values));
  });
});

describe("query() cannot be handed a built string", () => {
  // These lines are checked by the compiler, not run: tsc fails the build if any
  // of the @ts-expect-error lines ever starts to compile.
  function compileTimeOnly(db: ReturnType<typeof createDb>, userInput: string): void {
    // @ts-expect-error a string, with the value baked in, is not a Statement
    void db.query(`SELECT * FROM visitor WHERE display_name = '${userInput}'`);
    // @ts-expect-error a plain string is not a Statement
    void db.query("SELECT 1");
    // @ts-expect-error a look-alike object is not a Statement (the class has a #private brand)
    void db.query({ text: "SELECT 1", values: [] });
    // @ts-expect-error the Statement class is not exported as a value, so nobody can construct one
    void new Statement("SELECT 1", []);
  }
  void compileTimeOnly;

  it("refuses a string at run time as well (a cast, or plain JavaScript)", async () => {
    const { db, calls } = harness();
    const error = await rejection(db.query("SELECT 1" as unknown as Statement));
    assert.ok(error instanceof DbError);
    assert.equal(error.kind, "unexpected");
    assert.equal(calls.length, 0, "nothing was sent to the database");
  });

  it("refuses a look-alike object at run time", async () => {
    const { db, calls } = harness();
    const error = await rejection(db.query({ text: "SELECT 1", values: [] } as unknown as Statement));
    assert.ok(error instanceof DbError);
    assert.equal(calls.length, 0);
  });
});

describe("query()", () => {
  it("sends the text and the values separately and returns rows and rowCount", async () => {
    const { db, calls } = harness(() => ({ rows: [{ n: 1 }], rowCount: 1 }));
    const result = await db.query<{ n: number }>(sql`SELECT ${1}::int AS n`);
    assert.deepEqual(result, { rows: [{ n: 1 }], rowCount: 1 });
    assert.deepEqual(calls, [{ via: "pool", text: "SELECT $1::int AS n", values: [1] }]);
  });

  it("reports a null rowCount as 0", async () => {
    const { db } = harness(() => ({ rows: [], rowCount: null }));
    assert.equal((await db.query(sql`SELECT 1`)).rowCount, 0);
  });

  it("turns a unique violation into a DbError with the mapped message", async () => {
    const { db, entries } = harness(() => {
      throw pgError({ code: "23505", constraint: "staff_email_lower_key", table: "staff" });
    });
    const error = await rejection(db.query(sql`INSERT INTO staff DEFAULT VALUES`));
    assert.ok(error instanceof DbError);
    assert.equal(error.kind, "unique");
    assert.equal(error.field, "email");
    assert.equal(error.errorId, "E-FAKE");
    assert.deepEqual(entries[0], { event: "db_error", errorId: "E-FAKE", kind: "unique", sqlstate: "23505", constraint: "staff_email_lower_key", table: "staff" });
    assertNoLeak(error, entries);
  });

  it("tells an unreachable database apart from a typing mistake", async () => {
    const { db } = harness(() => {
      throw pgError({ code: "ECONNREFUSED" });
    });
    const error = await rejection(db.query(sql`SELECT 1`));
    assert.ok(error instanceof DbError);
    assert.equal(error.kind, "unavailable");
  });

  it("passes a DbError from getPool (for example 'not configured') through unchanged", async () => {
    const entries: DbErrorLogEntry[] = [];
    const config = new DbError("config", "The database is not set up for this application.", "E-CFG");
    const db = createDb(() => {
      throw config;
    }, { log: (entry) => void entries.push(entry) });
    assert.equal(await rejection(db.query(sql`SELECT 1`)), config);
    assert.equal(entries.length, 0, "already logged where it was made");
  });

  it("maps a raw error thrown by getPool without leaking it", async () => {
    const entries: DbErrorLogEntry[] = [];
    const db = createDb(() => {
      throw pgError({ message: "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string" });
    }, { log: (entry) => void entries.push(entry) });
    const error = await rejection(db.query(sql`SELECT 1`));
    assert.ok(error instanceof DbError);
    assert.equal(error.kind, "config");
    assertNoLeak(error, entries);
  });
});

describe("transaction()", () => {
  it("runs BEGIN, the statements, COMMIT on ONE connection and releases it", async () => {
    const { db, calls, released, connects } = harness();
    const result = await db.transaction(async (tx) => {
      await tx.query(sql`INSERT INTO a VALUES (${1})`);
      await tx.query(sql`INSERT INTO b VALUES (${2})`);
      return "done";
    });
    assert.equal(result, "done");
    assert.deepEqual(calls.map((call) => call.text), ["BEGIN", "INSERT INTO a VALUES ($1)", "INSERT INTO b VALUES ($1)", "COMMIT"]);
    assert.ok(calls.every((call) => call.via === "client"), "every statement used the one checked-out connection");
    assert.equal(connects(), 1);
    assert.deepEqual(released, [undefined], "released once, back to the pool");
  });

  it("rolls back and releases when the callback throws, and rethrows the SAME error", async () => {
    const { db, calls, released } = harness();
    const mine = new Error("my own mistake");
    const error = await rejection(
      db.transaction(async (tx) => {
        await tx.query(sql`INSERT INTO a VALUES (${1})`);
        throw mine;
      }),
    );
    assert.equal(error, mine, "the application's error is not wrapped or replaced");
    assert.deepEqual(calls.map((call) => call.text), ["BEGIN", "INSERT INTO a VALUES ($1)", "ROLLBACK"]);
    assert.ok(!calls.some((call) => call.text === "COMMIT"));
    assert.deepEqual(released, [undefined]);
  });

  it("rolls back when a statement inside it fails, and the caller gets a mapped DbError", async () => {
    const { db, calls, released, entries } = harness((text) => {
      if (text.startsWith("INSERT")) throw pgError({ code: "23514", constraint: "visit_checkout_after_checkin_check", table: "visit" });
      return undefined;
    });
    const error = await rejection(db.transaction(async (tx) => void (await tx.query(sql`INSERT INTO visit VALUES (${1})`))));
    assert.ok(error instanceof DbError);
    assert.equal(error.kind, "check");
    assert.equal(error.message, "Check-out cannot be earlier than check-in.");
    assert.deepEqual(calls.map((call) => call.text), ["BEGIN", "INSERT INTO visit VALUES ($1)", "ROLLBACK"]);
    assert.deepEqual(released, [undefined]);
    assertNoLeak(error, entries);
  });

  it("maps a COMMIT failure (serialization) and still rolls back and releases", async () => {
    const { db, calls, released, entries } = harness((text) => {
      if (text === "COMMIT") throw pgError({ code: "40001" });
      return undefined;
    });
    const error = await rejection(db.transaction(async () => "x"));
    assert.ok(error instanceof DbError);
    assert.equal(error.kind, "retryable");
    assert.deepEqual(calls.map((call) => call.text), ["BEGIN", "COMMIT", "ROLLBACK"]);
    assert.deepEqual(released, [undefined]);
    assertNoLeak(error, entries);
  });

  it("maps a BEGIN failure and releases", async () => {
    const { db, released, entries } = harness((text) => {
      if (text === "BEGIN") throw pgError({ code: "57P01" });
      return undefined;
    });
    const error = await rejection(db.transaction(async () => "x"));
    assert.ok(error instanceof DbError);
    assert.equal(error.kind, "unavailable");
    assert.deepEqual(released, [undefined]);
    assertNoLeak(error, entries);
  });

  it("DESTROYS the connection if the rollback itself fails, and still reports the original error", async () => {
    const { db, released } = harness((text) => {
      if (text === "ROLLBACK") throw pgError({ code: "ECONNRESET" });
      return undefined;
    });
    const mine = new Error("work failed");
    const error = await rejection(db.transaction(async () => Promise.reject(mine)));
    assert.equal(error, mine, "not the rollback failure");
    assert.deepEqual(released, [true], "release(true): the bad connection is not reused");
  });

  it("a failed connect is a DbError, and there is nothing to release", async () => {
    const { db, calls, released, entries } = harness(undefined, pgError({ code: "53300" }));
    const error = await rejection(db.transaction(async () => "x"));
    assert.ok(error instanceof DbError);
    assert.equal(error.kind, "unavailable");
    assert.equal(calls.length, 0);
    assert.equal(released.length, 0);
    assertNoLeak(error, entries);
  });

  it("releases exactly once on every path", async () => {
    const scenarios: [string, Script, () => Promise<unknown>][] = [];
    const never: Script = () => undefined;
    const failOn = (word: string): Script => (text) => {
      if (text.startsWith(word)) throw pgError({ code: "40001" });
      return undefined;
    };
    scenarios.push(["commit", never, async () => "ok"]);
    scenarios.push(["work throws", never, async () => Promise.reject(new Error("x"))]);
    scenarios.push(["work throws synchronously", never, async () => {
      throw new Error("x");
    }]);
    scenarios.push(["statement fails", failOn("INSERT"), async () => "ok"]);
    scenarios.push(["commit fails", failOn("COMMIT"), async () => "ok"]);
    scenarios.push(["begin fails", failOn("BEGIN"), async () => "ok"]);
    for (const [name, script, work] of scenarios) {
      const { db, released } = harness(script);
      try {
        await db.transaction(async (tx) => {
          if (name === "statement fails") await tx.query(sql`INSERT INTO a VALUES (${1})`);
          return work();
        });
      } catch {
        // expected for the failing scenarios
      }
      assert.equal(released.length, 1, `${name}: released ${released.length} times`);
    }
  });

  it("refuses a statement after the transaction has ended", async () => {
    const { db, calls } = harness();
    let leaked: Parameters<Parameters<typeof db.transaction>[0]>[0] | undefined;
    await db.transaction(async (tx) => void (leaked = tx));
    const before = calls.length;
    const error = await rejection(leaked!.query(sql`SELECT 1`));
    assert.ok(error instanceof DbError);
    assert.equal(calls.length, before, "the released connection was not touched");
  });

  it("refuses a built string inside a transaction too", async () => {
    const { db, calls, released } = harness();
    const error = await rejection(db.transaction(async (tx) => void (await tx.query("SELECT 1" as unknown as Statement))));
    assert.ok(error instanceof DbError);
    assert.deepEqual(calls.map((call) => call.text), ["BEGIN", "ROLLBACK"]);
    assert.deepEqual(released, [undefined]);
  });

  it("two transactions use two checkouts", async () => {
    const { db, connects, released } = harness();
    await db.transaction(async () => 1);
    await db.transaction(async () => 2);
    assert.equal(connects(), 2);
    assert.equal(released.length, 2);
  });
});

describe("a connection string, or any part of one, never appears in anything thrown or logged", () => {
  const leakyScripts: [string, Script | undefined, unknown, (db: ReturnType<typeof createDb>) => Promise<unknown>][] = [
    ["query: unique violation", () => { throw pgError({ code: "23505", constraint: "visitor_phone_live_key" }); }, undefined, (db) => db.query(sql`SELECT 1`)],
    ["query: unmapped constraint", () => { throw pgError({ code: "23505", constraint: "nobody_mapped_this" }); }, undefined, (db) => db.query(sql`SELECT 1`)],
    ["query: connection refused", () => { throw pgError({ code: "ECONNREFUSED" }); }, undefined, (db) => db.query(sql`SELECT 1`)],
    ["query: host not found", () => { throw pgError({ code: "ENOTFOUND", hostname: "db.canary-host.example" }); }, undefined, (db) => db.query(sql`SELECT 1`)],
    ["query: auth failed", () => { throw pgError({ code: "28P01" }); }, undefined, (db) => db.query(sql`SELECT 1`)],
    ["query: timeout, no code", () => { throw pgError({ message: "Connection terminated due to connection timeout" }); }, undefined, (db) => db.query(sql`SELECT 1`)],
    ["query: error with no fields at all", () => { throw pgError({}); }, undefined, (db) => db.query(sql`SELECT 1`)],
    ["transaction: connect fails", undefined, pgError({ code: "ECONNREFUSED" }), (db) => db.transaction(async () => 1)],
    ["transaction: BEGIN fails", (text) => { if (text === "BEGIN") throw pgError({ code: "57P01" }); return undefined; }, undefined, (db) => db.transaction(async () => 1)],
    ["transaction: COMMIT fails", (text) => { if (text === "COMMIT") throw pgError({ code: "40001" }); return undefined; }, undefined, (db) => db.transaction(async () => 1)],
    ["transaction: statement fails", (text) => { if (text.startsWith("INSERT")) throw pgError({ code: "23503", constraint: "handover_visit_id_fkey" }); return undefined; }, undefined, (db) => db.transaction(async (tx) => void (await tx.query(sql`INSERT INTO x VALUES (${1})`)))],
  ];

  for (const [name, script, connectError, act] of leakyScripts) {
    it(name, async () => {
      const { db, entries } = harness(script, connectError);
      const error = await rejection(act(db));
      assert.ok(error instanceof DbError, "a DbError, never the raw error");
      assertNoLeak(error, entries);
      assert.equal(entries.length, 1, "logged once");
    });
  }

  it("also through the default logger (console.error)", async () => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      const pool: PoolLike = {
        async query() {
          throw pgError({ code: "23505", constraint: "staff_email_lower_key", table: "staff" });
        },
        async connect() {
          throw pgError({ code: "ECONNREFUSED" });
        },
      };
      const db = createDb(() => pool);
      await rejection(db.query(sql`SELECT 1`));
      await rejection(db.transaction(async () => 1));
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 2);
    for (const secret of SECRETS) assert.ok(!lines.join("\n").includes(secret), `leaked ${secret}`);
  });
});
