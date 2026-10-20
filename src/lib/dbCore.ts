// The database layer without the driver: statements, query(), transaction().
// src/lib/db.ts hands it a real `pg` pool; the tests hand it a fake one. Nothing
// here opens a connection, imports pg, or reads the environment, so everything
// below is testable with no database.
//
// Relative imports with .ts extensions: Node's test runner loads this directly.
import { appDbError, toDbError, type ToDbErrorOptions } from "./dbErrors.ts";

/** A value that goes to the database as a parameter ($1, $2, ...), never as SQL text. */
export type DbParam =
  | string
  | number
  | boolean
  | bigint
  | Date
  | Uint8Array
  | null
  | readonly (string | number | boolean | bigint | Date | null)[];

// ---------------------------------------------------------------------------
// Statements. WHY query() DOES NOT TAKE A STRING.
//
// `query(text: string, values: unknown[])` accepts
//     query(`SELECT ... WHERE id = '${id}'`, [])
// and the compiler is perfectly happy: the signature cannot tell a constant from
// a string somebody built out of user input. So query() accepts only a
// Statement, and the only way to make one is the sql`` tag below. In a tagged
// template every ${value} becomes a numbered parameter and its value travels
// separately; the text between the ${...} is the only SQL text, and it is the
// literal text in the source file. There is no way to splice a value into SQL
// text through this API short of `as`, and the runtime check in query() refuses
// anything that is not a Statement (a cast, or plain JavaScript).
//
// The class has a #private field, so TypeScript treats it nominally: an object
// literal { text, values } does not satisfy a Statement parameter. And the class
// itself is NOT exported, only its type: no other module can write
// `new Statement("..." + x, [])`. The sql tag is the only constructor.
class StatementImpl {
  #brand = true;
  readonly text: string;
  readonly values: readonly DbParam[];

  constructor(text: string, values: readonly DbParam[]) {
    this.text = text;
    this.values = values;
    Object.freeze(this);
  }

  static isStatement(value: unknown): value is StatementImpl {
    return value instanceof StatementImpl && value.#brand === true;
  }
}

/** A parameterized statement. Made only by sql``; the type is exported, the class is not. */
export type Statement = StatementImpl;

const MANUAL_PLACEHOLDER = /\$\d/;

export function sql(strings: TemplateStringsArray, ...values: DbParam[]): Statement {
  let text = "";
  for (let i = 0; i < strings.length; i += 1) {
    const part = strings[i] ?? "";
    // A hand-written $1 next to ${} placeholders would collide with the numbering.
    if (MANUAL_PLACEHOLDER.test(part)) {
      throw new TypeError("sql``: write ${value}, not $1. Placeholders are numbered for you.");
    }
    text += part;
    if (i < values.length) text += `$${i + 1}`;
  }
  for (const value of values) {
    if (value === undefined) throw new TypeError("sql``: a parameter is undefined. Pass null for NULL.");
    if (StatementImpl.isStatement(value)) throw new TypeError("sql``: a statement cannot be nested in another.");
  }
  return new StatementImpl(text, Object.freeze([...values]));
}

// ---------------------------------------------------------------------------
// The pool seam.

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

interface RawResult {
  rows: unknown[];
  rowCount: number | null;
}

export interface ClientLike {
  query(text: string, values: readonly unknown[]): Promise<RawResult>;
  /** release(true) destroys the connection instead of returning it to the pool. */
  release(destroy?: boolean): void;
}

export interface PoolLike {
  query(text: string, values: readonly unknown[]): Promise<RawResult>;
  connect(): Promise<ClientLike>;
}

export type Row = Record<string, unknown>;

export interface Tx {
  query<R extends Row = Row>(statement: Statement): Promise<QueryResult<R>>;
}

export interface Db {
  query<R extends Row = Row>(statement: Statement): Promise<QueryResult<R>>;
  /**
   * Runs `work` in BEGIN ... COMMIT on one connection. A throw from `work`, or
   * from COMMIT, rolls back; the connection goes back to the pool on EVERY path
   * (or is destroyed if the rollback itself failed). Not re-entrant: do not call
   * transaction() from inside `work`. Use the `tx` you are given.
   */
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

export function createDb(getPool: () => PoolLike, options: ToDbErrorOptions = {}): Db {
  const fail = (raw: unknown) => toDbError(raw, options);

  function checked(statement: unknown): Statement {
    if (!StatementImpl.isStatement(statement)) {
      // A caller passed a string or a look-alike. That is a bug in the caller.
      throw appDbError("unexpected", options);
    }
    return statement;
  }

  async function run<R extends Row>(
    target: { query(text: string, values: readonly unknown[]): Promise<RawResult> },
    statement: Statement,
  ): Promise<QueryResult<R>> {
    const result = await target.query(statement.text, statement.values);
    return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
  }

  async function query<R extends Row = Row>(statement: Statement): Promise<QueryResult<R>> {
    const stmt = checked(statement);
    try {
      return await run<R>(getPool(), stmt);
    } catch (error) {
      throw fail(error);
    }
  }

  async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    let client: ClientLike;
    try {
      client = await getPool().connect();
    } catch (error) {
      throw fail(error);
    }

    let destroy = false;
    let open = true;
    const tx: Tx = {
      async query<R extends Row = Row>(statement: Statement): Promise<QueryResult<R>> {
        if (!open) throw appDbError("unexpected", options); // used after the transaction ended
        const stmt = checked(statement);
        try {
          return await run<R>(client, stmt);
        } catch (error) {
          throw fail(error);
        }
      },
    };

    try {
      // BEGIN and COMMIT go to the client directly, so their failures are raw
      // driver errors and are mapped here. Everything `work` throws is already a
      // DbError (from tx.query) or the application's own error: both are left alone.
      try {
        await client.query("BEGIN", []);
      } catch (error) {
        throw fail(error);
      }
      const result = await work(tx);
      try {
        await client.query("COMMIT", []);
      } catch (error) {
        throw fail(error);
      }
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK", []);
      } catch {
        // The connection is in an unknown state: do not hand it back to the pool.
        destroy = true;
      }
      throw error;
    } finally {
      open = false;
      client.release(destroy ? true : undefined);
    }
  }

  return { query, transaction };
}
