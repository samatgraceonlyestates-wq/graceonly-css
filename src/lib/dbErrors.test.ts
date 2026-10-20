// The error boundary, tested with synthetic pg errors only: no database, no
// network. Run: npm test
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, it } from "node:test";
import {
  CONSTRAINT_RULES,
  NOT_NULL_RULES,
  UNTRIPPABLE_CONSTRAINTS,
} from "./dbConstraints.ts";
import {
  DB_ERROR_MESSAGES,
  DB_INPUT_KINDS,
  DbError,
  appDbError,
  isDbError,
  isInputError,
  newErrorId,
  toDbError,
  type DbErrorLogEntry,
} from "./dbErrors.ts";

// Everything a real pg error can carry data in. If any of these strings turns up
// in a DbError or a log line, the boundary leaks.
const CANARY = "CANARY-9f3a-visitor-Amaka-Okafor";
const CANARY_URL = "postgresql://canary_user:CANARYpw9f3a@db.canary-host.example:5432/canary_db";

function rawError(fields: Record<string, unknown>): Error {
  // The case's own text (for the errors classified by their wording) comes first,
  // then the canary, so the message ALWAYS carries data a leak would expose.
  const { message, ...rest } = fields;
  const error = new Error(`${typeof message === "string" ? message : "error"} :: ${CANARY} ${CANARY_URL}`);
  return Object.assign(error, {
    detail: `Key (client_name_logged)=(${CANARY}) already exists.`,
    hint: `${CANARY} hint`,
    where: `${CANARY} where`,
    schema: `${CANARY}_schema`,
    column: `${CANARY}_column`,
    dataType: `${CANARY}_type`,
    host: "db.canary-host.example",
    hostname: "db.canary-host.example",
    address: "10.9.8.7",
    user: "canary_user",
    severity: "ERROR",
    ...rest,
  });
}

const SQLSTATE_FOR_KIND = { unique: "23505", foreign_key: "23503", check: "23514" } as const;

function capture() {
  const entries: DbErrorLogEntry[] = [];
  return { entries, log: (entry: DbErrorLogEntry) => void entries.push(entry) };
}

/** Everything observable about an error, as text, so a leak anywhere is found. */
function everything(error: Error, entries: DbErrorLogEntry[]): string {
  return [
    error.message,
    error.stack ?? "",
    String(error),
    JSON.stringify(error),
    JSON.stringify(Object.getOwnPropertyNames(error).map((name) => String((error as unknown as Record<string, unknown>)[name]))),
    inspect(error, { depth: 6, showHidden: true }),
    JSON.stringify(entries),
  ].join("\n");
}

function assertNoLeak(text: string): void {
  for (const secret of [CANARY, "CANARYpw9f3a", "canary_user", "canary-host", "canary_db", "10.9.8.7"]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
}

describe("every user-trippable constraint maps to its fixed message", () => {
  for (const [name, rule] of Object.entries(CONSTRAINT_RULES)) {
    it(`${name} (${rule.kind})`, () => {
      const { entries, log } = capture();
      const error = toDbError(rawError({ code: SQLSTATE_FOR_KIND[rule.kind], constraint: name, table: "some_table" }), { log });
      assert.equal(error.kind, rule.kind);
      assert.equal(error.message, rule.message);
      assert.equal(error.field, rule.field);
      assert.ok(isInputError(error));
      assertNoLeak(everything(error, entries));
    });
  }

  it("covers every kind the caller needs to tell apart", () => {
    const kinds = new Set(Object.values(CONSTRAINT_RULES).map((rule) => rule.kind));
    assert.deepEqual([...kinds].sort(), ["check", "foreign_key", "unique"]);
  });

  it("a rule only answers the kind of violation it was written for", () => {
    // A unique rule's name arriving with a foreign key SQLSTATE is not that rule.
    const { log } = capture();
    const error = toDbError(rawError({ code: "23503", constraint: "staff_email_lower_key" }), { log });
    assert.equal(error.kind, "unexpected");
    assert.equal(error.message, DB_ERROR_MESSAGES.unexpected);
  });
});

describe("constraints a person cannot trip are NOT mapped", () => {
  for (const name of Object.keys(UNTRIPPABLE_CONSTRAINTS)) {
    it(`${name} gives the generic message, and the name is logged`, () => {
      const sqlstate = name.endsWith("_fkey") ? "23503" : name.endsWith("_check") ? "23514" : "23505";
      const { entries, log } = capture();
      const error = toDbError(rawError({ code: sqlstate, constraint: name }), { log });
      assert.equal(error.kind, "unexpected");
      assert.equal(error.message, DB_ERROR_MESSAGES.unexpected);
      assert.equal(error.field, null);
      assert.equal(entries[0]?.constraint, name);
      assertNoLeak(everything(error, entries));
    });
  }

  it("a constraint nobody has heard of is generic too", () => {
    const { entries, log } = capture();
    const error = toDbError(rawError({ code: "23505", constraint: "brand_new_key" }), { log });
    assert.equal(error.kind, "unexpected");
    assert.equal(entries[0]?.constraint, "brand_new_key");
  });
});

describe("NOT NULL (no constraint name on PostgreSQL 10): mapped by table.column", () => {
  for (const [key, rule] of Object.entries(NOT_NULL_RULES)) {
    it(key, () => {
      const [table, column] = key.split(".");
      const { entries, log } = capture();
      const error = toDbError(rawError({ code: "23502", table, column }), { log });
      assert.equal(error.kind, "not_null");
      assert.equal(error.message, rule.message);
      assert.equal(error.field, rule.field);
      assert.ok(isInputError(error));
      assertNoLeak(everything(error, entries));
    });
  }

  it("a NOT NULL column nobody types is generic", () => {
    const error = toDbError(rawError({ code: "23502", table: "visit", column: "checked_in_by" }), { log: () => {} });
    assert.equal(error.kind, "unexpected");
  });

  it("with no table or column it is generic and does not throw", () => {
    assert.equal(toDbError({ code: "23502" }, { log: () => {} }).kind, "unexpected");
  });
});

describe("a caller can tell a typing mistake from an unreachable database", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    // unreachable
    ["connection refused", { code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.9.8.7:5432" }, "unavailable"],
    ["host not found", { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND db.canary-host.example" }, "unavailable"],
    ["lookup retry", { code: "EAI_AGAIN" }, "unavailable"],
    ["connection reset", { code: "ECONNRESET" }, "unavailable"],
    ["broken pipe (looks like a SQLSTATE)", { code: "EPIPE" }, "unavailable"],
    ["no route", { code: "EHOSTUNREACH" }, "unavailable"],
    ["connection exception 08006", { code: "08006" }, "unavailable"],
    ["connection failure 08001", { code: "08001" }, "unavailable"],
    ["server shutting down", { code: "57P01" }, "unavailable"],
    ["crash shutdown", { code: "57P02" }, "unavailable"],
    ["cannot connect now", { code: "57P03" }, "unavailable"],
    ["too many connections (shared server)", { code: "53300" }, "unavailable"],
    ["out of memory", { code: "53200" }, "unavailable"],
    ["password rejected", { code: "28P01" }, "unavailable"],
    ["role not permitted", { code: "28000" }, "unavailable"],
    ["database does not exist", { code: "3D000" }, "unavailable"],
    ["dropped, no code", { message: "Connection terminated unexpectedly" }, "unavailable"],
    ["client not queryable, no code", { message: "Client has encountered a connection error and is not queryable" }, "unavailable"],
    ["pool already ended, no code", { message: "Cannot use a pool after calling end on the pool" }, "unavailable"],
    // too slow
    ["socket timed out", { code: "ETIMEDOUT" }, "timeout"],
    ["statement timeout", { code: "57014" }, "timeout"],
    ["idle in transaction timeout", { code: "25P03" }, "timeout"],
    ["pool could not give a connection", { message: "timeout exceeded when trying to connect" }, "timeout"],
    ["connect timeout, terminated", { message: "Connection terminated due to connection timeout" }, "timeout"],
    ["client query timeout", { message: "Query read timeout" }, "timeout"],
    // try again
    ["deadlock", { code: "40P01" }, "retryable"],
    ["serialization failure", { code: "40001" }, "retryable"],
    ["lock not available", { code: "55P03" }, "retryable"],
    // bad input
    ["invalid uuid in a URL", { code: "22P02" }, "malformed"],
    ["value too long", { code: "22001" }, "malformed"],
    ["number out of range", { code: "22003" }, "malformed"],
    ["bad date", { code: "22007" }, "malformed"],
    // other
    ["append-only trigger", { code: "23001" }, "restricted"],
    ["connection string unusable", { message: "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string" }, "config"],
    ["syntax error in our own SQL", { code: "42601" }, "unexpected"],
    ["undefined table", { code: "42P01" }, "unexpected"],
    ["insufficient privilege", { code: "42501" }, "unexpected"],
    ["a plain Error", { message: "something odd" }, "unexpected"],
  ];

  for (const [name, fields, kind] of cases) {
    it(`${name} -> ${kind}`, () => {
      const { entries, log } = capture();
      const error = toDbError(rawError(fields), { log });
      assert.equal(error.kind, kind);
      assert.equal(error.message, kind in DB_ERROR_MESSAGES ? DB_ERROR_MESSAGES[kind as keyof typeof DB_ERROR_MESSAGES] : error.message);
      assertNoLeak(everything(error, entries));
    });
  }

  it("only the first group is 'you typed something invalid'", () => {
    for (const kind of ["unique", "foreign_key", "check", "not_null", "malformed"] as const) {
      assert.ok(DB_INPUT_KINDS.has(kind), kind);
    }
    for (const kind of ["unavailable", "timeout", "retryable", "config", "restricted", "unexpected"] as const) {
      assert.ok(!DB_INPUT_KINDS.has(kind), kind);
      assert.ok(!isInputError(new DbError(kind, "m", "E-0")), kind);
    }
  });
});

describe("what is logged, and what is not", () => {
  it("logs exactly the safe facts: id, kind, SQLSTATE, constraint, table", () => {
    const { entries, log } = capture();
    toDbError(rawError({ code: "23505", constraint: "staff_email_lower_key", table: "staff" }), { log, newId: () => "E-TEST" });
    assert.deepEqual(entries, [
      { event: "db_error", errorId: "E-TEST", kind: "unique", sqlstate: "23505", constraint: "staff_email_lower_key", table: "staff" },
    ]);
  });

  it("never logs message, detail, hint, where, column, schema, host, user or the raw object", () => {
    const { entries, log } = capture();
    toDbError(rawError({ code: "23505", constraint: "unmapped_key", table: "visit" }), { log });
    toDbError(rawError({ code: "ECONNREFUSED" }), { log });
    toDbError(rawError({}), { log });
    const allowed = new Set(["event", "errorId", "kind", "sqlstate", "constraint", "table"]);
    for (const entry of entries) {
      for (const key of Object.keys(entry)) assert.ok(allowed.has(key), `unexpected log key ${key}`);
    }
    assertNoLeak(JSON.stringify(entries));
  });

  it("drops a constraint or table value that is not a plain identifier", () => {
    const { entries, log } = capture();
    toDbError(rawError({ code: "23505", constraint: `x\n${CANARY}`, table: `a b ${CANARY}` }), { log });
    assert.equal(entries[0]?.constraint, undefined);
    assert.equal(entries[0]?.table, undefined);
    assertNoLeak(JSON.stringify(entries));
  });

  it("drops a code that is not a SQLSTATE", () => {
    const { entries, log } = capture();
    toDbError(rawError({ code: `${CANARY}` }), { log });
    assert.equal(entries[0]?.sqlstate, undefined);
    assertNoLeak(JSON.stringify(entries));
  });

  it("the default logger writes one JSON line to console.error and nothing else", () => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      toDbError(rawError({ code: "23505", constraint: "staff_email_lower_key", table: "staff" }));
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(parsed.event, "db_error");
    assertNoLeak(lines.join("\n"));
  });

  it("a logger that throws does not replace the error being reported", () => {
    const error = toDbError(rawError({ code: "23505", constraint: "staff_email_lower_key" }), {
      log: () => {
        throw new Error("log sink down");
      },
    });
    assert.equal(error.kind, "unique");
  });
});

describe("the error id", () => {
  it("is app-generated, short, and has a fixed format", () => {
    assert.match(newErrorId(), /^E-[0-9A-F]{10}$/);
  });

  it("is different every time, even for the same error", () => {
    const raw = rawError({ code: "23505", constraint: "staff_email_lower_key" });
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) ids.add(toDbError(raw, { log: () => {} }).errorId);
    assert.equal(ids.size, 500);
  });

  it("is not derived from the error", () => {
    const first = toDbError(rawError({ code: "ECONNREFUSED" }), { log: () => {} }).errorId;
    const second = toDbError(rawError({ code: "ECONNREFUSED" }), { log: () => {} }).errorId;
    assert.notEqual(first, second);
    assert.ok(!first.includes("ECONN"));
  });

  it("is the one in the log entry", () => {
    const { entries, log } = capture();
    const error = toDbError(rawError({ code: "40001" }), { log });
    assert.equal(entries[0]?.errorId, error.errorId);
  });
});

describe("a DbError has no way back to the raw error", () => {
  it("carries no cause and only its own fields", () => {
    const error = toDbError(rawError({ code: "23505", constraint: "staff_email_lower_key" }), { log: () => {} });
    assert.equal((error as unknown as { cause?: unknown }).cause, undefined);
    assert.deepEqual(Object.keys(error).sort(), ["errorId", "field", "kind", "name"]);
    assert.ok(isDbError(error));
    assert.equal(error.name, "DbError");
  });

  it("a DbError passed in again is returned as is and not logged twice", () => {
    const { entries, log } = capture();
    const first = toDbError(rawError({ code: "40001" }), { log });
    const second = toDbError(first, { log });
    assert.equal(second, first);
    assert.equal(entries.length, 1);
  });

  it("copes with anything being thrown", () => {
    for (const thrown of [undefined, null, 0, "a string", { code: 5 }, [], () => {}, Symbol("s")]) {
      const error = toDbError(thrown, { log: () => {} });
      assert.equal(error.kind, "unexpected");
    }
  });

  it("appDbError is the same shape, with a fixed message", () => {
    const { entries, log } = capture();
    const error = appDbError("config", { log });
    assert.equal(error.kind, "config");
    assert.equal(error.message, DB_ERROR_MESSAGES.config);
    assert.equal(entries[0]?.kind, "config");
  });
});

describe("the fixed messages", () => {
  it("are plain sentences for staff, with no database vocabulary", () => {
    const all = [
      ...Object.values(DB_ERROR_MESSAGES),
      ...Object.values(CONSTRAINT_RULES).map((rule) => rule.message),
      ...Object.values(NOT_NULL_RULES).map((rule) => rule.message),
    ];
    for (const message of all) {
      assert.match(message, /\.$/);
      assert.ok(message.length < 160, message);
      assert.doesNotMatch(message, /constraint|violat|sql|postgres|pg_|null value|foreign key|duplicate key|relation/i, message);
    }
  });
});
