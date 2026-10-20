// The ONLY module in CSS that opens a database connection. Everything else calls
// query() and transaction() from here and never imports `pg`.
//
// SERVER-ONLY. The guard below throws if this module is ever evaluated in a
// browser, and the connection string is read from DATABASE_URL (no NEXT_PUBLIC_
// prefix, so Next never inlines it into a client bundle). It is read when the
// pool is first needed, never at module scope. The pool necessarily keeps it
// (to open replacement connections); this module does not keep another copy.
//
// The connection string, or any part of it, is NEVER logged, returned or put in
// an error. A pg connection error's message can carry the host and the user, so
// no pg error leaves this layer raw: see dbErrors.ts and the HARD RULE in
// CLAUDE.md ("Database"). What a caller gets is a DbError.
//
// Dates: a `date` column (leave) comes back as the string "YYYY-MM-DD", never as
// a JavaScript Date, which would be parsed as local midnight and be a day out.
// `timestamptz` comes back as a Date (an instant), which is correct.
//
// UUIDs are made by the caller with crypto.randomUUID(). There is no
// gen_random_uuid() on PostgreSQL 10.

import { Pool, types } from "pg";
import {
  createDb,
  sql,
  type ClientLike,
  type Db,
  type PoolLike,
  type QueryResult,
  type Row,
  type Statement,
  type Tx,
} from "./dbCore.ts";
import { appDbError, DbError, isDbError, isInputError, toDbError } from "./dbErrors.ts";

// Imports are hoisted, so this runs at load whatever its position; it is here
// to read as the first statement of the module's own code.
if (typeof window !== "undefined") {
  throw new Error("src/lib/db.ts is server-only and must never be imported into client code.");
}

export { sql, DbError, isDbError, isInputError };
export type { DbErrorKind } from "./dbErrors.ts";
export type { DbParam, QueryResult, Row, Statement, Tx } from "./dbCore.ts";

export const DATABASE_ENV = "DATABASE_URL";

// ---------------------------------------------------------------------------
// POOL SIZE. WHY IT IS SMALL.
//
// This runs against SHARED cPanel PostgreSQL. max_connections is a server-wide
// limit that this application shares with every other database user on the host;
// we do not control it and are not told what it is or how much of it is already
// used. A pool that is too big does not make CSS faster: it takes connections
// other tenants need, and when the server runs out (SQLSTATE 53300) EVERY
// application on it starts failing, ours included. CSS has 20 to 30 staff and
// short queries; five connections is already generous for that.
//
// RAISING THESE NUMBERS IS A DECISION ABOUT A SHARED SERVER, NOT A PERFORMANCE
// KNOB. Do it only after finding out the real max_connections and current usage,
// and tell whoever runs the host.
//
// The other limits exist for the same reason: nothing here may hold a connection
// or a lock longer than a front-desk action needs.
export const POOL_SETTINGS = Object.freeze({
  max: 5,
  /** How long query() waits for a free connection before failing as a timeout. */
  connectionTimeoutMillis: 5_000,
  /** An idle connection is closed after this long, returning it to the shared server. */
  idleTimeoutMillis: 10_000,
  /** Server-side: a statement running longer than this is cancelled (SQLSTATE 57014). */
  statement_timeout: 15_000,
  /** Server-side: a transaction left open and idle this long is ended (SQLSTATE 25P03). */
  idle_in_transaction_session_timeout: 15_000,
  /** Client-side backstop when the server cannot be reached to cancel. */
  query_timeout: 20_000,
  application_name: "graceonly-css",
});

const DATE_OID = 1082;

/** pg's default parsers, except `date`, which stays the string the database sent. */
export const POOL_TYPES = Object.freeze({
  getTypeParser(oid: number, format?: string) {
    if (oid === DATE_OID) return (value: string) => value;
    return types.getTypeParser(oid, format === "binary" ? "binary" : "text");
  },
});

// ONE pool per process. The pool lives on globalThis because Next can evaluate
// this module more than once in a process (development reloads, and separately
// bundled routes); a module-level variable would then mean several pools of
// five, and the whole point of the small number is lost.
const POOL_KEY = Symbol.for("graceonly-css.db.pool");
type PoolHolder = { [POOL_KEY]?: Pool };

function logPoolError(error: unknown): void {
  // An idle client can error (the server restarted). Without a listener Node
  // would crash the process. This logs the safe facts and nothing else.
  toDbError(error);
}

function getPool(): PoolLike {
  const holder = globalThis as PoolHolder;
  let pool = holder[POOL_KEY];
  if (pool === undefined) {
    const url = process.env[DATABASE_ENV]?.trim();
    // Checked without parsing, and the value is never echoed. new URL() would
    // keep the input on the error it throws.
    if (!url || !/^postgres(ql)?:\/\//.test(url)) throw appDbError("config");
    pool = new Pool({ connectionString: url, ...POOL_SETTINGS, types: POOL_TYPES });
    pool.on("error", logPoolError);
    holder[POOL_KEY] = pool;
  }
  return adapt(pool);
}

function adapt(pool: Pool): PoolLike {
  return {
    async query(text, values) {
      const result = await pool.query(text, [...values]);
      return { rows: result.rows, rowCount: result.rowCount };
    },
    async connect(): Promise<ClientLike> {
      const client = await pool.connect();
      return {
        async query(text, values) {
          const result = await client.query(text, [...values]);
          return { rows: result.rows, rowCount: result.rowCount };
        },
        release(destroy) {
          client.release(destroy);
        },
      };
    },
  };
}

const db: Db = createDb(getPool);

/** Runs one parameterized statement. Throws DbError. Build the statement with sql``. */
export function query<R extends Row = Row>(statement: Statement): Promise<QueryResult<R>> {
  return db.query<R>(statement);
}

/** BEGIN ... COMMIT on one connection; rolls back and releases on every path. Throws DbError. */
export function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(work);
}

/** Ends the pool. For scripts and tests so the process can exit; the app never calls it. */
export async function closeDb(): Promise<void> {
  const holder = globalThis as PoolHolder;
  const pool = holder[POOL_KEY];
  if (pool === undefined) return;
  holder[POOL_KEY] = undefined;
  try {
    await pool.end();
  } catch (error) {
    toDbError(error); // logged by the safe path, never rethrown raw
  }
}
