// Authentication rules: sign in, sessions, password change. CSS's OWN, end to
// end: nothing here calls the portal, so signing in works when the portal is down.
//
// The service owns every rule. It reaches the database only through the
// AuthStore interface (authStore.ts is the PostgreSQL implementation; the tests
// use an in-memory one with a fake clock), and it takes the password hasher and
// the clock as arguments. No Next, no cookies, no `pg` in here.
//
// THE RULES THAT MATTER
//
// Timing parity. Every sign-in attempt that gets past the cheap input checks does
// EXACTLY ONE scrypt verification, whether or not the account exists, whether or
// not it is locked, whether or not it is active (passwords.verify(password, null)
// runs the same work against a dummy hash). It then does exactly one
// write-shaped query on a failure (a real update for a live account, a no-op for
// a missing or locked one). So an unknown address is not faster than a wrong
// password, and a locked account is not faster than either. Left: a few
// milliseconds of database round trip against ~100 ms of scrypt.
//
// Same answer. A wrong password, an unknown address and an inactive account all
// get the same message. A locked account and an unknown address that has been
// tried five times get the same "locked" message, because the second is SIMULATED
// (SimulatedLockout): otherwise only real accounts would ever lock, and trying an
// address until it locked would prove it exists.
//
// Lock. `lockAfterFailures` failures in a row lock the account for `lockMinutes`
// (password_failed_count, password_locked_until). The failure that applies the
// lock restarts the count; attempts during the lock change nothing; a success
// resets it. The update is a single atomic statement, so concurrent attempts
// cannot step over the limit.
//
// IP. Failures are also counted per address (SlidingWindowLimiter) and checked
// BEFORE the expensive work, so one address cannot try many accounts.
//
// The database is the clock. Every date the rules compare comes back from the
// store with the database's `now()`, never from the web server's clock.
//
// Roster people. `staff` also holds people who never sign in (the staff whose
// attendance the front desk records): their password_hash is NULL. A row with no
// hash is NOT an account here: signInAccount() turns it into "no account", so the
// rest of the rules see exactly what they see for an address that does not exist
// (one scrypt run against the dummy hash, a no-op write, the same message, the
// same simulated lockout, no staff id in the log). It is checked here, in the
// rules, and not only in the SQL, so a store that forgets cannot let one in.
//
// A plaintext password is never logged, returned or placed in an error. The log
// carries a reason and, when the email matched a real account, the staff id. It
// NEVER carries the typed email, or anything identifying when none matched.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AUTH_POLICY,
  SESSION_TOKEN_PATTERN,
  looksLikeEmail,
  normaliseEmail,
  validateNewPassword,
} from "./authPolicy.ts";
import { SimulatedLockout, SlidingWindowLimiter, type Clock } from "./failureLimiter.ts";
import { PasswordBusyError, type PasswordHasher } from "./password.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_LOGIN_PASSWORD_CHARS = 1024;

// ---------------------------------------------------------------------------
// What the service needs from the database

export interface AccountRow {
  id: string;
  /** NULL for a roster person, who cannot sign in. Never read it directly: use signInAccount(). */
  passwordHash: string | null;
  mustChangePassword: boolean;
  isActive: boolean;
  failedCount: number;
  lockedUntil: Date | null;
  /** The database's clock at the moment of the read. */
  dbNow: Date;
}

export interface SessionRow {
  sessionId: string;
  staffId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  fullName: string;
  /** NULL until a department is set (roster people are entered before they have one). */
  department: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  dbNow: Date;
}

/** An account that can sign in: it has a password hash. */
type SignInAccount = AccountRow & { passwordHash: string };

/** A row with no password hash is a roster person, not an account: treat it as no account at all. */
export function signInAccount(row: AccountRow | null): SignInAccount | null {
  return row !== null && typeof row.passwordHash === "string" && row.passwordHash !== ""
    ? { ...row, passwordHash: row.passwordHash }
    : null;
}

export interface AuthStore {
  findAccountByEmail(email: string): Promise<AccountRow | null>;
  findAccountById(id: string): Promise<AccountRow | null>;
  /**
   * Counts one failure ATOMICALLY and applies the lock when the count reaches
   * `lockAfter`. Returns null if the account was already locked (nothing changed).
   */
  recordFailure(id: string, rule: { lockAfter: number; lockMinutes: number }): Promise<{ lockedUntil: Date | null; dbNow: Date } | null>;
  /** A write-shaped query that changes nothing, so a failure costs the same whoever it was for. */
  noopWrite(): Promise<void>;
  resetFailures(id: string): Promise<void>;
  /** Sets the hash, clears must_change_password, clears the failure state. */
  setPassword(id: string, hash: string): Promise<void>;
  /** Replaces an outdated hash, only if it is still the one we read. */
  upgradeHash(id: string, oldHash: string, newHash: string): Promise<void>;
  createSession(input: { id: string; staffId: string; tokenHash: string; ip: string | null; absoluteHours: number }): Promise<{ expiresAt: Date }>;
  findSession(tokenHash: string): Promise<SessionRow | null>;
  touchSession(sessionId: string): Promise<void>;
  revokeSession(tokenHash: string): Promise<void>;
  revokeAllSessions(staffId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Results and log events

export const MESSAGES = Object.freeze({
  invalid: "Email or password is incorrect.",
  ipLimited: "Too many attempts from this connection. Try again later.",
  busy: "The server is busy. Try again in a moment.",
  invalidCurrent: "The current password is incorrect.",
  locked: (seconds: number) => {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `Too many failed attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  },
});

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; staffId: string; mustChangePassword: boolean }
  | { ok: false; reason: "invalid" | "locked" | "ip_limited" | "busy"; message: string; retryAfterSeconds: number | null };

export type ChangePasswordResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "weak" | "invalid_current" | "locked" | "ip_limited" | "busy" | "no_account"; message: string; retryAfterSeconds: number | null };

export interface SessionUser {
  sessionId: string;
  staffId: string;
  fullName: string;
  department: string | null;
  roles: string[];
  mustChangePassword: boolean;
}

export type SessionResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "missing" | "unknown" | "revoked" | "expired" | "idle" | "inactive" };

export type AuthLogEvent =
  | { event: "auth_login"; staffId: string }
  | {
      event: "auth_login_failed";
      reason: "bad_password" | "locked" | "inactive" | "unknown_account" | "ip_limited" | "invalid_input" | "busy";
      /** Present only when the email matched a real account. */
      staffId?: string;
    }
  | { event: "auth_password_changed"; staffId: string }
  | { event: "auth_password_change_failed"; reason: "invalid_current" | "locked" | "weak" | "ip_limited" | "busy"; staffId: string }
  | { event: "auth_rehash_failed"; staffId: string };

export interface AuthDeps {
  store: AuthStore;
  passwords: PasswordHasher;
  log?: (event: AuthLogEvent) => void;
  /** Clock for the in-memory limiters. Account and session rules use the database's. */
  now?: Clock;
  ipLimiter?: SlidingWindowLimiter;
  emailLockout?: SimulatedLockout;
  newToken?: () => string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function defaultLog(event: AuthLogEvent): void {
  console.error(JSON.stringify(event));
}

function secondsUntil(later: Date, now: Date): number {
  return Math.max(1, Math.ceil((later.getTime() - now.getTime()) / 1000));
}

export interface AuthService {
  login(input: { email: unknown; password: unknown; ip: string | null }): Promise<LoginResult>;
  resolveSession(token: unknown): Promise<SessionResult>;
  logout(token: unknown): Promise<void>;
  changePassword(input: { staffId: string; currentPassword: unknown; newPassword: unknown; ip: string | null }): Promise<ChangePasswordResult>;
}

export function createAuthService(deps: AuthDeps): AuthService {
  const { store, passwords } = deps;
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? Date.now;
  const ipLimiter =
    deps.ipLimiter ??
    new SlidingWindowLimiter({ limit: AUTH_POLICY.ipFailureLimit, windowMs: AUTH_POLICY.ipWindowMinutes * MINUTE, now });
  const emailLockout =
    deps.emailLockout ?? new SimulatedLockout({ lockAfter: AUTH_POLICY.lockAfterFailures, lockMs: AUTH_POLICY.lockMinutes * MINUTE, now });
  const newToken = deps.newToken ?? (() => randomBytes(32).toString("base64url"));
  const lockRule = { lockAfter: AUTH_POLICY.lockAfterFailures, lockMinutes: AUTH_POLICY.lockMinutes };

  const safeLog = (event: AuthLogEvent) => {
    try {
      log(event);
    } catch {
      // A broken log sink must never change what a sign-in does.
    }
  };

  const failure = (reason: "invalid" | "locked" | "ip_limited" | "busy", retryAfterSeconds: number | null = null) =>
    ({
      ok: false,
      reason,
      retryAfterSeconds,
      message:
        reason === "locked"
          ? MESSAGES.locked(retryAfterSeconds ?? AUTH_POLICY.lockMinutes * 60)
          : reason === "ip_limited"
            ? MESSAGES.ipLimited
            : reason === "busy"
              ? MESSAGES.busy
              : MESSAGES.invalid,
    }) as const;

  async function openSession(staffId: string, ip: string | null): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const { expiresAt } = await store.createSession({
      id: randomUUID(),
      staffId,
      tokenHash: hashToken(token),
      ip,
      absoluteHours: AUTH_POLICY.sessionAbsoluteHours,
    });
    return { token, expiresAt };
  }

  /** One failed password check against a real account: counts it, applies the lock, reports. */
  async function countFailure(account: AccountRow): Promise<{ locked: boolean; seconds: number }> {
    const locked = account.lockedUntil !== null && account.lockedUntil.getTime() > account.dbNow.getTime();
    if (locked && account.lockedUntil) {
      await store.noopWrite();
      return { locked: true, seconds: secondsUntil(account.lockedUntil, account.dbNow) };
    }
    const result = await store.recordFailure(account.id, lockRule);
    if (result === null) return { locked: true, seconds: AUTH_POLICY.lockMinutes * 60 }; // locked by a concurrent attempt
    if (result.lockedUntil !== null && result.lockedUntil.getTime() > result.dbNow.getTime()) {
      return { locked: true, seconds: secondsUntil(result.lockedUntil, result.dbNow) };
    }
    return { locked: false, seconds: 0 };
  }

  async function login(input: { email: unknown; password: unknown; ip: string | null }): Promise<LoginResult> {
    const email = normaliseEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    const ipKey = input.ip ?? "unknown";

    // 1. The address has used up its failures: refuse before any expensive work.
    //    The answer depends on the address only, never on the account.
    if (ipLimiter.isBlocked(ipKey)) {
      safeLog({ event: "auth_login_failed", reason: "ip_limited" });
      return failure("ip_limited", ipLimiter.retryAfterSeconds(ipKey));
    }

    // 2. Input that can never be a credential. Decided from the input alone, so
    //    it says nothing about any account.
    if (!looksLikeEmail(email) || password.length === 0 || password.length > MAX_LOGIN_PASSWORD_CHARS) {
      ipLimiter.recordFailure(ipKey);
      safeLog({ event: "auth_login_failed", reason: "invalid_input" });
      return failure("invalid");
    }

    // 3. Look up, then verify ONCE, always.
    const account = signInAccount(await store.findAccountByEmail(email));
    let matched: boolean;
    try {
      matched = await passwords.verify(password, account === null ? null : account.passwordHash);
    } catch (error) {
      if (error instanceof PasswordBusyError) return failure("busy");
      throw error;
    }

    const emailKey = createHash("sha256").update(email.toLowerCase()).digest("hex");
    const accountLocked =
      account !== null && account.lockedUntil !== null && account.lockedUntil.getTime() > account.dbNow.getTime();

    // 4. Success: a real, active, unlocked account and the right password.
    if (account !== null && !accountLocked && account.isActive && matched) {
      if (account.failedCount > 0 || account.lockedUntil !== null) await store.resetFailures(account.id);
      if (passwords.needsRehash(account.passwordHash)) {
        try {
          await store.upgradeHash(account.id, account.passwordHash, await passwords.hash(password));
        } catch {
          // Never fail a correct sign-in over a hash upgrade. It is tried again next time.
          safeLog({ event: "auth_rehash_failed", staffId: account.id });
        }
      }
      const session = await openSession(account.id, input.ip);
      safeLog({ event: "auth_login", staffId: account.id });
      return { ok: true, ...session, staffId: account.id, mustChangePassword: account.mustChangePassword };
    }

    // 5. Every other outcome is a failure, and costs the same.
    ipLimiter.recordFailure(ipKey);
    let locked: boolean;
    let seconds: number;
    if (account !== null) {
      ({ locked, seconds } = await countFailure(account));
    } else {
      await store.noopWrite();
      locked = emailLockout.recordFailure(emailKey);
      seconds = emailLockout.lockedForSeconds(emailKey);
    }

    safeLog(
      account === null
        ? { event: "auth_login_failed", reason: "unknown_account" }
        : {
            event: "auth_login_failed",
            reason: accountLocked ? "locked" : !account.isActive ? "inactive" : "bad_password",
            staffId: account.id,
          },
    );
    return locked ? failure("locked", seconds) : failure("invalid");
  }

  async function resolveSession(token: unknown): Promise<SessionResult> {
    if (typeof token !== "string" || !SESSION_TOKEN_PATTERN.test(token)) return { ok: false, reason: "missing" };
    const row = await store.findSession(hashToken(token));
    if (row === null) return { ok: false, reason: "unknown" };

    const at = row.dbNow.getTime();
    if (row.revokedAt !== null) return { ok: false, reason: "revoked" };
    if (at >= row.expiresAt.getTime()) return { ok: false, reason: "expired" };
    if (at - row.lastSeenAt.getTime() >= AUTH_POLICY.sessionIdleHours * HOUR) return { ok: false, reason: "idle" };
    if (!row.isActive) return { ok: false, reason: "inactive" };

    if (at - row.lastSeenAt.getTime() >= AUTH_POLICY.touchIntervalMinutes * MINUTE) {
      await store.touchSession(row.sessionId);
    }
    return {
      ok: true,
      user: {
        sessionId: row.sessionId,
        staffId: row.staffId,
        fullName: row.fullName,
        department: row.department,
        roles: row.roles,
        mustChangePassword: row.mustChangePassword,
      },
    };
  }

  async function logout(token: unknown): Promise<void> {
    if (typeof token !== "string" || !SESSION_TOKEN_PATTERN.test(token)) return;
    // The row is revoked, not just the cookie: a copied token stops working too.
    await store.revokeSession(hashToken(token));
  }

  async function changePassword(input: {
    staffId: string;
    currentPassword: unknown;
    newPassword: unknown;
    ip: string | null;
  }): Promise<ChangePasswordResult> {
    const ipKey = input.ip ?? "unknown";
    const fail = (
      reason: "weak" | "invalid_current" | "locked" | "ip_limited" | "busy" | "no_account",
      message: string,
      retryAfterSeconds: number | null = null,
    ) => ({ ok: false, reason, message, retryAfterSeconds }) as const;

    if (ipLimiter.isBlocked(ipKey)) {
      safeLog({ event: "auth_password_change_failed", reason: "ip_limited", staffId: input.staffId });
      return fail("ip_limited", MESSAGES.ipLimited, ipLimiter.retryAfterSeconds(ipKey));
    }
    const account = signInAccount(await store.findAccountById(input.staffId));
    if (account === null || !account.isActive) return fail("no_account", MESSAGES.invalid);

    const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
    const weak = validateNewPassword(input.newPassword, current);
    if (weak !== null) {
      safeLog({ event: "auth_password_change_failed", reason: "weak", staffId: account.id });
      return fail("weak", weak);
    }
    const newPassword = input.newPassword as string;

    let matched: boolean;
    try {
      matched = await passwords.verify(current.slice(0, MAX_LOGIN_PASSWORD_CHARS), account.passwordHash);
    } catch (error) {
      if (error instanceof PasswordBusyError) return fail("busy", MESSAGES.busy);
      throw error;
    }
    const locked = account.lockedUntil !== null && account.lockedUntil.getTime() > account.dbNow.getTime();
    if (locked || !matched) {
      // A wrong current password is a failed password check like any other.
      ipLimiter.recordFailure(ipKey);
      const counted = await countFailure(account);
      safeLog({ event: "auth_password_change_failed", reason: counted.locked ? "locked" : "invalid_current", staffId: account.id });
      return counted.locked ? fail("locked", MESSAGES.locked(counted.seconds), counted.seconds) : fail("invalid_current", MESSAGES.invalidCurrent);
    }

    try {
      await store.setPassword(account.id, await passwords.hash(newPassword));
    } catch (error) {
      if (error instanceof PasswordBusyError) return fail("busy", MESSAGES.busy);
      throw error;
    }
    // Every existing session ends, this one included; a fresh one replaces it, so
    // a token that was copied before the change stops working.
    await store.revokeAllSessions(account.id);
    const session = await openSession(account.id, input.ip);
    safeLog({ event: "auth_password_changed", staffId: account.id });
    return { ok: true, ...session };
  }

  return { login, resolveSession, logout, changePassword };
}
