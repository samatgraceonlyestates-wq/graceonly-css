// The PostgreSQL implementation of AuthStore. Every query goes through db.ts
// (parameterized, errors mapped); nothing here opens a connection.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
//
// The database's own now() is the clock for every comparison: the rows come back
// with db_now, and authCore.ts decides lock, expiry and idle from THAT, not from
// the web server's clock.
//
// The session token is never stored. token_hash is the SHA-256 (hex) of the
// token, which authCore.ts computes; this file only ever sees the hash.
import { randomUUID } from "node:crypto";
import { query, sql } from "./db.ts";
import type { AccountRow, AuthStore, SessionRow } from "./authCore.ts";

type AccountDbRow = {
  id: string;
  password_hash: string;
  must_change_password: boolean;
  is_active: boolean;
  failed_count: number;
  locked_until: Date | null;
  db_now: Date;
};

function toAccount(row: AccountDbRow): AccountRow {
  return {
    id: row.id,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password,
    isActive: row.is_active,
    failedCount: row.failed_count,
    lockedUntil: row.locked_until,
    dbNow: row.db_now,
  };
}

export const pgAuthStore: AuthStore = {
  async findAccountByEmail(email) {
    // lower() on both sides: the unique index is on lower(email), so this uses it.
    const { rows } = await query<AccountDbRow>(sql`
      SELECT id, password_hash, must_change_password, is_active,
             password_failed_count AS failed_count, password_locked_until AS locked_until, now() AS db_now
        FROM staff
       WHERE lower(email) = lower(${email})`);
    const row = rows[0];
    return row === undefined ? null : toAccount(row);
  },

  async findAccountById(id) {
    const { rows } = await query<AccountDbRow>(sql`
      SELECT id, password_hash, must_change_password, is_active,
             password_failed_count AS failed_count, password_locked_until AS locked_until, now() AS db_now
        FROM staff
       WHERE id = ${id}`);
    const row = rows[0];
    return row === undefined ? null : toAccount(row);
  },

  async recordFailure(id, rule) {
    // ONE atomic statement. The count and the lock are decided by the row's own
    // values at the moment it is updated, so two simultaneous wrong guesses
    // cannot both read "4" and both write "5". When the lock is applied the count
    // restarts at 0. A row that is currently locked does not match, so nothing
    // changes during a lock and the result is "no row".
    const { rows } = await query<{ locked_until: Date | null; db_now: Date }>(sql`
      UPDATE staff
         SET password_failed_count = CASE WHEN password_failed_count + 1 >= ${rule.lockAfter}
                                          THEN 0 ELSE password_failed_count + 1 END,
             password_locked_until = CASE WHEN password_failed_count + 1 >= ${rule.lockAfter}
                                          THEN now() + make_interval(mins => ${rule.lockMinutes})
                                          ELSE password_locked_until END
       WHERE id = ${id}
         AND (password_locked_until IS NULL OR password_locked_until <= now())
   RETURNING password_locked_until AS locked_until, now() AS db_now`);
    const row = rows[0];
    return row === undefined ? null : { lockedUntil: row.locked_until, dbNow: row.db_now };
  },

  async noopWrite() {
    // Matches no row (a fresh random id) but is parsed, planned and sent like the
    // real update, so a failure for an unknown or locked account costs the same
    // round trip as one for a live account.
    await query(sql`
      UPDATE staff
         SET password_failed_count = password_failed_count + 1
       WHERE id = ${randomUUID()}`);
  },

  async resetFailures(id) {
    await query(sql`UPDATE staff SET password_failed_count = 0, password_locked_until = NULL WHERE id = ${id}`);
  },

  async setPassword(id, hash) {
    await query(sql`
      UPDATE staff
         SET password_hash = ${hash}, must_change_password = false,
             password_failed_count = 0, password_locked_until = NULL
       WHERE id = ${id}`);
  },

  async upgradeHash(id, oldHash, newHash) {
    await query(sql`UPDATE staff SET password_hash = ${newHash} WHERE id = ${id} AND password_hash = ${oldHash}`);
  },

  async createSession({ id, staffId, tokenHash, ip, absoluteHours }) {
    // device_id stays NULL: no device is registered yet. expires_at is the
    // database's clock plus the absolute lifetime.
    const { rows } = await query<{ expires_at: Date }>(sql`
      INSERT INTO session (id, staff_id, device_id, token_hash, ip, expires_at)
      VALUES (${id}, ${staffId}, NULL, ${tokenHash}, ${ip}, now() + make_interval(hours => ${absoluteHours}))
   RETURNING expires_at`);
    const row = rows[0];
    if (row === undefined) throw new Error("The session was not created.");
    return { expiresAt: row.expires_at };
  },

  async findSession(tokenHash) {
    const { rows } = await query<{
      session_id: string;
      staff_id: string;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
      full_name: string;
      department: string;
      is_active: boolean;
      must_change_password: boolean;
      roles: string[];
      db_now: Date;
    }>(sql`
      SELECT s.id AS session_id, s.staff_id, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
             st.full_name, st.department, st.is_active, st.must_change_password,
             ARRAY(SELECT sr.role_code FROM staff_role sr WHERE sr.staff_id = st.id ORDER BY sr.role_code) AS roles,
             now() AS db_now
        FROM session s
        JOIN staff st ON st.id = s.staff_id
       WHERE s.token_hash = ${tokenHash}`);
    const row = rows[0];
    if (row === undefined) return null;
    const session: SessionRow = {
      sessionId: row.session_id,
      staffId: row.staff_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      fullName: row.full_name,
      department: row.department,
      isActive: row.is_active,
      mustChangePassword: row.must_change_password,
      roles: row.roles,
      dbNow: row.db_now,
    };
    return session;
  },

  async touchSession(sessionId) {
    // At most once a minute, so browsing does not turn into a write per page.
    await query(sql`
      UPDATE session SET last_seen_at = now()
       WHERE id = ${sessionId} AND revoked_at IS NULL AND last_seen_at < now() - interval '1 minute'`);
  },

  async revokeSession(tokenHash) {
    await query(sql`UPDATE session SET revoked_at = now() WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`);
  },

  async revokeAllSessions(staffId) {
    await query(sql`UPDATE session SET revoked_at = now() WHERE staff_id = ${staffId} AND revoked_at IS NULL`);
  },
};
