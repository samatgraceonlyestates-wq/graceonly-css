// The authentication service against an in-memory store with a fake clock: no
// database, no network. Run: npm test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  createAuthService,
  hashToken,
  type AccountRow,
  type AuthLogEvent,
  type AuthStore,
  type SessionRow,
} from "./authCore.ts";
import { AUTH_POLICY, decideAccess } from "./authPolicy.ts";
import { SimulatedLockout, SlidingWindowLimiter } from "./failureLimiter.ts";
import { PasswordBusyError, createPasswordHasher, passwords as productionHasher, type PasswordHasher } from "./password.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Cheap scrypt parameters for the rules (the real ones are exercised in
// password.test.ts and in the timing test below).
const CHEAP = { N: 1024, r: 8, p: 1, keyLength: 64 } as const;
const cheap = createPasswordHasher({ params: CHEAP });

const PASSWORD = "correct horse battery staple";
const CANARY_PASSWORD = "CANARY-PASSWORD-9f3a-Zq7!";
const TYPED_EMAIL_CANARY = "typo.canary9f3a@canary-domain.example";

// ---------------------------------------------------------------------------
// The fake: the same rules as authStore.ts, in memory, on a clock the test moves.

interface MemAccount {
  id: string;
  email: string;
  passwordHash: string;
  mustChangePassword: boolean;
  isActive: boolean;
  failedCount: number;
  lockedUntil: number | null;
  fullName: string;
  department: string;
  roles: string[];
}

interface MemSession {
  id: string;
  staffId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  ip: string | null;
  deviceId: null;
}

class MemoryStore implements AuthStore {
  now = Date.UTC(2026, 9, 16, 8, 0, 0);
  accounts = new Map<string, MemAccount>();
  sessions = new Map<string, MemSession>(); // keyed by token_hash
  /** Every write-shaped call, in order, so parity can be asserted. */
  writes: string[] = [];
  touches = 0;

  async addAccount(input: { id: string; email: string; password: string; hasher?: PasswordHasher; mustChange?: boolean; active?: boolean; roles?: string[] }) {
    this.accounts.set(input.id, {
      id: input.id,
      email: input.email,
      passwordHash: await (input.hasher ?? cheap).hash(input.password),
      mustChangePassword: input.mustChange ?? false,
      isActive: input.active ?? true,
      failedCount: 0,
      lockedUntil: null,
      fullName: "Test Person",
      department: "Front desk",
      roles: input.roles ?? ["FRONT_DESK"],
    });
  }

  private row(account: MemAccount): AccountRow {
    return {
      id: account.id,
      passwordHash: account.passwordHash,
      mustChangePassword: account.mustChangePassword,
      isActive: account.isActive,
      failedCount: account.failedCount,
      lockedUntil: account.lockedUntil === null ? null : new Date(account.lockedUntil),
      dbNow: new Date(this.now),
    };
  }

  async findAccountByEmail(email: string) {
    const found = [...this.accounts.values()].find((account) => account.email.toLowerCase() === email.toLowerCase());
    return found ? this.row(found) : null;
  }
  async findAccountById(id: string) {
    const found = this.accounts.get(id);
    return found ? this.row(found) : null;
  }
  async recordFailure(id: string, rule: { lockAfter: number; lockMinutes: number }) {
    this.writes.push("recordFailure");
    const account = this.accounts.get(id);
    if (!account) return null;
    if (account.lockedUntil !== null && account.lockedUntil > this.now) return null; // the SQL matches no row
    const reached = account.failedCount + 1 >= rule.lockAfter;
    account.failedCount = reached ? 0 : account.failedCount + 1;
    if (reached) account.lockedUntil = this.now + rule.lockMinutes * MINUTE;
    return { lockedUntil: account.lockedUntil === null ? null : new Date(account.lockedUntil), dbNow: new Date(this.now) };
  }
  async noopWrite() {
    this.writes.push("noopWrite");
  }
  async resetFailures(id: string) {
    this.writes.push("resetFailures");
    const account = this.accounts.get(id);
    if (account) {
      account.failedCount = 0;
      account.lockedUntil = null;
    }
  }
  async setPassword(id: string, hash: string) {
    this.writes.push("setPassword");
    const account = this.accounts.get(id);
    if (account) {
      account.passwordHash = hash;
      account.mustChangePassword = false;
      account.failedCount = 0;
      account.lockedUntil = null;
    }
  }
  async upgradeHash(id: string, oldHash: string, newHash: string) {
    this.writes.push("upgradeHash");
    const account = this.accounts.get(id);
    if (account && account.passwordHash === oldHash) account.passwordHash = newHash;
  }
  async createSession(input: { id: string; staffId: string; tokenHash: string; ip: string | null; absoluteHours: number }) {
    this.writes.push("createSession");
    const expiresAt = this.now + input.absoluteHours * HOUR;
    this.sessions.set(input.tokenHash, {
      id: input.id,
      staffId: input.staffId,
      createdAt: this.now,
      lastSeenAt: this.now,
      expiresAt,
      revokedAt: null,
      ip: input.ip,
      deviceId: null,
    });
    return { expiresAt: new Date(expiresAt) };
  }
  async findSession(tokenHash: string): Promise<SessionRow | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    const account = this.accounts.get(session.staffId);
    if (!account) return null;
    return {
      sessionId: session.id,
      staffId: session.staffId,
      createdAt: new Date(session.createdAt),
      lastSeenAt: new Date(session.lastSeenAt),
      expiresAt: new Date(session.expiresAt),
      revokedAt: session.revokedAt === null ? null : new Date(session.revokedAt),
      fullName: account.fullName,
      department: account.department,
      isActive: account.isActive,
      mustChangePassword: account.mustChangePassword,
      roles: account.roles,
      dbNow: new Date(this.now),
    };
  }
  async touchSession(sessionId: string) {
    this.touches += 1;
    for (const session of this.sessions.values()) {
      if (session.id === sessionId && session.revokedAt === null) session.lastSeenAt = this.now;
    }
  }
  async revokeSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    if (session && session.revokedAt === null) session.revokedAt = this.now;
  }
  async revokeAllSessions(staffId: string) {
    for (const session of this.sessions.values()) {
      if (session.staffId === staffId && session.revokedAt === null) session.revokedAt = this.now;
    }
  }

  /** Every string the store holds, to prove what it does NOT hold. */
  everythingStored(): string {
    return JSON.stringify([[...this.accounts.values()], [...this.sessions.entries()]]);
  }
}

// ---------------------------------------------------------------------------
// Harness

let counter = 0;
function harness(options: { hasher?: PasswordHasher; ipLimit?: number } = {}) {
  const store = new MemoryStore();
  const events: AuthLogEvent[] = [];
  const base = options.hasher ?? cheap;
  const calls = { verify: 0, hash: 0, verifyAgainstNull: 0 };
  const hasher: PasswordHasher = {
    params: base.params,
    hash: (password) => {
      calls.hash += 1;
      return base.hash(password);
    },
    verify: (password, stored) => {
      calls.verify += 1;
      if (stored === null) calls.verifyAgainstNull += 1;
      return base.verify(password, stored);
    },
    needsRehash: (stored) => base.needsRehash(stored),
  };
  const now = () => store.now;
  const service = createAuthService({
    store,
    passwords: hasher,
    log: (event) => void events.push(event),
    now,
    ipLimiter: new SlidingWindowLimiter({ limit: options.ipLimit ?? AUTH_POLICY.ipFailureLimit, windowMs: AUTH_POLICY.ipWindowMinutes * MINUTE, now }),
    emailLockout: new SimulatedLockout({ lockAfter: AUTH_POLICY.lockAfterFailures, lockMs: AUTH_POLICY.lockMinutes * MINUTE, now }),
  });
  async function account(overrides: Partial<Parameters<MemoryStore["addAccount"]>[0]> = {}) {
    counter += 1;
    const input = { id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`, email: `staff${counter}@example.test`, password: PASSWORD, ...overrides };
    await store.addAccount(input);
    return input;
  }
  return { store, service, events, calls, account };
}

const IP = "203.0.113.7";
const login = (h: ReturnType<typeof harness>, email: string, password: string, ip: string | null = IP) =>
  h.service.login({ email, password, ip });

// ---------------------------------------------------------------------------

describe("signing in", () => {
  it("a correct password opens a session", async () => {
    const h = harness();
    const a = await h.account();
    const result = await login(h, a.email, PASSWORD);
    assert.ok(result.ok);
    assert.equal(result.staffId, a.id);
    assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(result.mustChangePassword, false);
    assert.equal(result.expiresAt.getTime(), h.store.now + 12 * HOUR);
  });

  it("the email is matched without regard to case or surrounding spaces", async () => {
    const h = harness();
    const a = await h.account({ email: "Mixed.Case@Example.test" });
    assert.ok((await login(h, "  mixed.case@example.TEST ", PASSWORD)).ok);
    assert.equal(a.id.length > 0, true);
  });

  it("the database holds the SHA-256 of the token and never the token", async () => {
    const h = harness();
    const a = await h.account();
    const result = await login(h, a.email, PASSWORD);
    assert.ok(result.ok);
    const stored = h.store.everythingStored();
    assert.ok(stored.includes(createHash("sha256").update(result.token).digest("hex")));
    assert.ok(!stored.includes(result.token), "the raw token is not stored anywhere");
    assert.equal(hashToken(result.token).length, 64);
    const session = [...h.store.sessions.values()][0];
    assert.equal(session?.deviceId, null, "device_id stays NULL: no device is registered yet");
  });

  it("a wrong password is refused with a fixed message and counted", async () => {
    const h = harness();
    const a = await h.account();
    const result = await login(h, a.email, "not the password");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "invalid");
    assert.equal(result.ok === false && result.message, "Email or password is incorrect.");
    assert.equal(h.store.accounts.get(a.id)?.failedCount, 1);
  });

  it("an unknown email, a wrong password and an inactive account get the IDENTICAL answer", async () => {
    const h = harness();
    const known = await h.account();
    const inactive = await h.account({ active: false });
    const wrong = await login(h, known.email, "nope-nope-nope");
    const unknown = await login(h, "nobody@example.test", "nope-nope-nope");
    const inactiveCorrect = await login(h, inactive.email, PASSWORD);
    assert.deepEqual(unknown, wrong);
    assert.deepEqual(inactiveCorrect, wrong);
  });

  it("a success resets the failure count", async () => {
    const h = harness();
    const a = await h.account();
    for (let i = 0; i < 3; i += 1) await login(h, a.email, "wrong-wrong-wrong");
    assert.equal(h.store.accounts.get(a.id)?.failedCount, 3);
    assert.ok((await login(h, a.email, PASSWORD)).ok);
    assert.equal(h.store.accounts.get(a.id)?.failedCount, 0);
  });

  it("reports must_change_password so the caller can force the change", async () => {
    const h = harness();
    const a = await h.account({ mustChange: true });
    const result = await login(h, a.email, PASSWORD);
    assert.ok(result.ok);
    assert.equal(result.mustChangePassword, true);
  });

  it("upgrades an outdated hash to today's parameters after a successful sign-in", async () => {
    const weaker = createPasswordHasher({ params: { N: 2048, r: 8, p: 1, keyLength: 64 } });
    const h = harness();
    const a = await h.account({ hasher: weaker });
    const before = h.store.accounts.get(a.id)?.passwordHash ?? "";
    assert.ok(cheap.needsRehash(before));
    assert.ok((await login(h, a.email, PASSWORD)).ok);
    const after = h.store.accounts.get(a.id)?.passwordHash ?? "";
    assert.notEqual(after, before);
    assert.ok(!cheap.needsRehash(after));
    assert.ok((await login(h, a.email, PASSWORD)).ok, "and the new hash works");
  });

  it("says 'busy' rather than queueing without limit", async () => {
    const h = harness({ hasher: { ...cheap, params: cheap.params, hash: cheap.hash, needsRehash: cheap.needsRehash, verify: async () => { throw new PasswordBusyError(); } } });
    const a = await h.account();
    const result = await login(h, a.email, PASSWORD);
    assert.equal(result.ok === false && result.reason, "busy");
  });

  it("input that can never be a credential is refused without any hashing", async () => {
    const h = harness();
    await h.account();
    for (const [email, password] of [["not-an-email", PASSWORD], ["", PASSWORD], ["a@b.example", ""], ["a@b.example", "x".repeat(2000)]] as const) {
      const result = await login(h, email, password);
      assert.equal(result.ok, false);
    }
    assert.equal(h.calls.verify, 0);
  });
});

describe("the lock: five failures lock the account for fifteen minutes", () => {
  it("the numbers are 5 and 15", () => {
    assert.equal(AUTH_POLICY.lockAfterFailures, 5);
    assert.equal(AUTH_POLICY.lockMinutes, 15);
  });

  it("locks at the FIFTH failure, not before", async () => {
    const h = harness();
    const a = await h.account();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await login(h, a.email, `wrong-password-${attempt}`);
      assert.equal(result.ok === false && result.reason, "invalid", `attempt ${attempt}`);
    }
    const fifth = await login(h, a.email, "wrong-password-5");
    assert.equal(fifth.ok === false && fifth.reason, "locked");
    assert.equal(fifth.ok === false && fifth.message, "Too many failed attempts. Try again in 15 minutes.");
    assert.equal(h.store.accounts.get(a.id)?.lockedUntil, h.store.now + 15 * MINUTE);
  });

  it("while locked even the CORRECT password is refused, and nothing is extended", async () => {
    const h = harness();
    const a = await h.account();
    for (let i = 0; i < 5; i += 1) await login(h, a.email, "wrong-password");
    const until = h.store.accounts.get(a.id)?.lockedUntil;
    h.store.now += 10 * MINUTE;
    const result = await login(h, a.email, PASSWORD);
    assert.equal(result.ok === false && result.reason, "locked");
    assert.equal(result.ok === false && result.message, "Too many failed attempts. Try again in 5 minutes.");
    assert.equal(h.store.accounts.get(a.id)?.lockedUntil, until, "attempts during a lock do not extend it");
  });

  it("the lock expires after fifteen minutes", async () => {
    const h = harness();
    const a = await h.account();
    for (let i = 0; i < 5; i += 1) await login(h, a.email, "wrong-password");
    h.store.now += 15 * MINUTE - 1000;
    assert.equal((await login(h, a.email, PASSWORD)).ok, false, "one second early: still locked");
    h.store.now += 2000;
    assert.ok((await login(h, a.email, PASSWORD)).ok, "after fifteen minutes it works");
    assert.equal(h.store.accounts.get(a.id)?.lockedUntil, null);
  });

  it("after a lock expires the count starts again: it takes five more, not one", async () => {
    const h = harness();
    const a = await h.account();
    for (let i = 0; i < 5; i += 1) await login(h, a.email, "wrong-password");
    h.store.now += 16 * MINUTE;
    const first = await login(h, a.email, "wrong-password");
    assert.equal(first.ok === false && first.reason, "invalid");
    assert.equal(h.store.accounts.get(a.id)?.failedCount, 1);
  });

  it("an address nobody has an account for locks the same way, so locking proves nothing", async () => {
    const h = harness();
    const real = await h.account();
    const outcomes = async (email: string) => {
      const out: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const r = await login(h, email, "wrong-password");
        out.push(r.ok ? "ok" : `${r.reason}:${r.message}`);
      }
      return out;
    };
    assert.deepEqual(await outcomes("never.heard.of@example.test"), await outcomes(real.email));
  });

  it("the simulated lock also expires and restarts, like the real one", async () => {
    const h = harness();
    const email = "ghost@example.test";
    for (let i = 0; i < 5; i += 1) await login(h, email, "wrong-password");
    const locked = await login(h, email, "wrong-password");
    assert.equal(locked.ok === false && locked.reason, "locked");
    h.store.now += 16 * MINUTE;
    const again = await login(h, email, "wrong-password");
    assert.equal(again.ok === false && again.reason, "invalid", "the simulated lock lapsed and the count restarted");
  });
});

describe("the address limit", () => {
  it("is higher than the per-account limit, because an office shares one address", () => {
    assert.equal(AUTH_POLICY.ipFailureLimit, 20);
    assert.ok(AUTH_POLICY.ipFailureLimit > AUTH_POLICY.lockAfterFailures);
  });

  it("stops one address trying many accounts, before any hashing", async () => {
    const h = harness({ ipLimit: 6 });
    for (let i = 0; i < 6; i += 1) await login(h, `target${i}@example.test`, "guess-guess-guess");
    const verifiesBefore = h.calls.verify;
    const real = await h.account();
    const blocked = await login(h, real.email, PASSWORD); // even a correct sign-in
    assert.equal(blocked.ok === false && blocked.reason, "ip_limited");
    assert.equal(h.calls.verify, verifiesBefore, "refused before any scrypt");
  });

  it("another address is unaffected, and the window slides", async () => {
    const h = harness({ ipLimit: 3 });
    const real = await h.account();
    for (let i = 0; i < 3; i += 1) await login(h, `t${i}@example.test`, "guess-guess-guess");
    assert.equal((await login(h, real.email, PASSWORD)).ok, false);
    assert.ok((await login(h, real.email, PASSWORD, "198.51.100.9")).ok, "a different address is fine");
    h.store.now += AUTH_POLICY.ipWindowMinutes * MINUTE + 1000;
    assert.ok((await login(h, real.email, PASSWORD)).ok, "after the window the first address is fine");
  });

  it("a success does not clear an address's failures", async () => {
    const h = harness({ ipLimit: 3 });
    const real = await h.account();
    await login(h, "a@example.test", "guess-guess-guess");
    await login(h, "b@example.test", "guess-guess-guess");
    assert.ok((await login(h, real.email, PASSWORD)).ok);
    await login(h, "c@example.test", "guess-guess-guess");
    assert.equal((await login(h, real.email, PASSWORD)).ok, false, "three failures still count");
  });
});

describe("timing parity between a known and an unknown email", () => {
  it("every attempt does EXACTLY ONE scrypt verification, whoever it is for", async () => {
    type Setup = (h: ReturnType<typeof harness>) => Promise<{ email: string; password: string }>;
    const scenarios: [string, Setup][] = [
      ["known, correct", async (h) => ({ email: (await h.account()).email, password: PASSWORD })],
      ["known, wrong", async (h) => ({ email: (await h.account()).email, password: "wrong-wrong-wrong" })],
      ["unknown", async () => ({ email: "nobody@example.test", password: "wrong-wrong-wrong" })],
      ["inactive, correct", async (h) => ({ email: (await h.account({ active: false })).email, password: PASSWORD })],
      ["locked, correct", async (h) => {
        const a = await h.account();
        for (let i = 0; i < 5; i += 1) await login(h, a.email, "wrong-password");
        return { email: a.email, password: PASSWORD };
      }],
    ];
    for (const [name, setup] of scenarios) {
      const h = harness();
      const { email, password } = await setup(h);
      h.calls.verify = 0; // count only the attempt under test
      h.calls.verifyAgainstNull = 0;
      await login(h, email, password);
      assert.equal(h.calls.verify, 1, `${name}: exactly one scrypt run`);
      assert.equal(h.calls.verifyAgainstNull, name === "unknown" ? 1 : 0, `${name}: dummy hash used only for a missing account`);
    }
  });

  it("every FAILED attempt does exactly one write-shaped query: real for a live account, a no-op for the rest", async () => {
    const h1 = harness();
    const a = await h1.account();
    await login(h1, a.email, "wrong-wrong-wrong");
    assert.deepEqual(h1.store.writes, ["recordFailure"]);

    const h2 = harness();
    await login(h2, "nobody@example.test", "wrong-wrong-wrong");
    assert.deepEqual(h2.store.writes, ["noopWrite"]);

    const h3 = harness();
    const b = await h3.account();
    for (let i = 0; i < 5; i += 1) await login(h3, b.email, "wrong-password");
    h3.store.writes.length = 0;
    await login(h3, b.email, PASSWORD);
    assert.deepEqual(h3.store.writes, ["noopWrite"], "locked: no real write, but the same shape of work");
  });

  it("with the REAL scrypt parameters an unknown email takes as long as a wrong password", async () => {
    const h = harness({ hasher: productionHasher });
    const a = await h.account({ hasher: productionHasher });
    const time = async (email: string) => {
      const started = process.hrtime.bigint();
      await login(h, email, "wrong-wrong-wrong", `203.0.113.${(counter += 1) % 250}`);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      known.push(await time(a.email));
      unknown.push(await time(`ghost${i}@example.test`));
    }
    const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0;
    const knownMedian = median(known);
    const unknownMedian = median(unknown);
    // scrypt at these parameters takes tens of milliseconds at the least; if the
    // unknown path skipped it, it would be hundreds of times faster, not within 2x.
    assert.ok(knownMedian > 15, `the known path really ran scrypt (${knownMedian.toFixed(1)} ms)`);
    assert.ok(unknownMedian > knownMedian * 0.5 && unknownMedian < knownMedian * 2, `known ${knownMedian.toFixed(1)} ms, unknown ${unknownMedian.toFixed(1)} ms`);
  });
});

describe("sessions", () => {
  async function signedIn(h: ReturnType<typeof harness>) {
    const a = await h.account();
    const result = await login(h, a.email, PASSWORD);
    assert.ok(result.ok);
    return { a, token: result.token };
  }

  it("a live session resolves to the person, with their roles", async () => {
    const h = harness();
    const a = await h.account({ roles: ["ADMIN", "LEGAL"] });
    const result = await login(h, a.email, PASSWORD);
    assert.ok(result.ok);
    const session = await h.service.resolveSession(result.token);
    assert.ok(session.ok);
    assert.equal(session.user.staffId, a.id);
    assert.deepEqual(session.user.roles, ["ADMIN", "LEGAL"]);
  });

  it("the lifetimes are 12 hours absolute and 3 hours idle", () => {
    assert.equal(AUTH_POLICY.sessionAbsoluteHours, 12);
    assert.equal(AUTH_POLICY.sessionIdleHours, 3);
  });

  it("refuses a token that is malformed or unknown", async () => {
    const h = harness();
    await signedIn(h);
    for (const token of [undefined, null, "", "short", "x".repeat(43) + "!", 12345]) {
      assert.deepEqual(await h.service.resolveSession(token), { ok: false, reason: "missing" });
    }
    assert.deepEqual(await h.service.resolveSession("A".repeat(43)), { ok: false, reason: "unknown" });
  });

  it("an idle session ends at three hours, and not a second before", async () => {
    const h = harness();
    const { token } = await signedIn(h);
    h.store.now += 3 * HOUR - 1000;
    assert.ok((await h.service.resolveSession(token)).ok, "2h59m59s idle: still valid");
    h.store.now += 3 * HOUR; // and then nothing for three hours
    assert.deepEqual(await h.service.resolveSession(token), { ok: false, reason: "idle" });
  });

  it("activity keeps a session alive, up to the absolute twelve hours", async () => {
    const h = harness();
    const { token } = await signedIn(h);
    for (let hours = 2; hours <= 10; hours += 2) {
      h.store.now += 2 * HOUR;
      assert.ok((await h.service.resolveSession(token)).ok, `at ${hours}h of constant use`);
    }
    h.store.now += 2 * HOUR - 1000; // 11h59m59s since sign-in
    assert.ok((await h.service.resolveSession(token)).ok);
    h.store.now += 2000; // 12h00m01s, and the person has been active the whole time
    assert.deepEqual(await h.service.resolveSession(token), { ok: false, reason: "expired" });
  });

  it("an expired session is refused whatever else is true", async () => {
    const h = harness();
    const { token } = await signedIn(h);
    h.store.now += 12 * HOUR;
    assert.deepEqual(await h.service.resolveSession(token), { ok: false, reason: "expired" });
  });

  it("logout REVOKES the row, so a copied token stops working", async () => {
    const h = harness();
    const { token } = await signedIn(h);
    const copy = token; // what someone who copied the cookie holds
    assert.ok((await h.service.resolveSession(copy)).ok);
    await h.service.logout(token);
    assert.deepEqual(await h.service.resolveSession(copy), { ok: false, reason: "revoked" });
    const row = h.store.sessions.get(hashToken(token));
    assert.notEqual(row?.revokedAt, null, "revoked_at is set on the row");
  });

  it("logging out with no or a bad token does nothing and does not throw", async () => {
    const h = harness();
    await h.service.logout(undefined);
    await h.service.logout("garbage");
    assert.equal(h.store.sessions.size, 0);
  });

  it("a deactivated account's sessions stop working", async () => {
    const h = harness();
    const { a, token } = await signedIn(h);
    const account = h.store.accounts.get(a.id);
    assert.ok(account);
    account.isActive = false;
    assert.deepEqual(await h.service.resolveSession(token), { ok: false, reason: "inactive" });
  });

  it("last_seen_at is refreshed at most once a minute", async () => {
    const h = harness();
    const { token } = await signedIn(h);
    h.store.now += 20_000;
    await h.service.resolveSession(token);
    h.store.now += 20_000;
    await h.service.resolveSession(token);
    assert.equal(h.store.touches, 0, "within the first minute: no write");
    h.store.now += 90_000;
    await h.service.resolveSession(token);
    assert.equal(h.store.touches, 1);
  });
});

describe("the must-change-password gate", () => {
  it("a person who must change their password gets nothing else, whatever role they hold", () => {
    const subject = { roles: ["SUPER_ADMIN", "ADMIN"], mustChangePassword: true };
    assert.deepEqual(decideAccess(subject), { ok: false, reason: "must_change_password" });
    assert.deepEqual(decideAccess(subject, { role: "ADMIN" }), { ok: false, reason: "must_change_password" });
    assert.deepEqual(decideAccess(subject, { allowPasswordChange: true }), { ok: true }, "except the change-password screen");
  });

  it("a new account is forced through it and then released", async () => {
    const h = harness();
    const a = await h.account({ mustChange: true, roles: ["ADMIN"] });
    const signIn = await login(h, a.email, PASSWORD);
    assert.ok(signIn.ok && signIn.mustChangePassword);
    const before = await h.service.resolveSession(signIn.token);
    assert.ok(before.ok && before.user.mustChangePassword);
    assert.deepEqual(decideAccess(before.user, { role: "ADMIN" }), { ok: false, reason: "must_change_password" });

    const changed = await h.service.changePassword({ staffId: a.id, currentPassword: PASSWORD, newPassword: "a brand new passphrase", ip: IP });
    assert.ok(changed.ok);
    const after = await h.service.resolveSession(changed.token);
    assert.ok(after.ok && !after.user.mustChangePassword);
    assert.deepEqual(decideAccess(after.user, { role: "ADMIN" }), { ok: true });
  });
});

describe("changing a password", () => {
  const NEW_PASSWORD = "a brand new passphrase";

  it("works, ends every older session, and issues a replacement", async () => {
    const h = harness();
    const a = await h.account();
    const first = await login(h, a.email, PASSWORD);
    const second = await login(h, a.email, PASSWORD, "198.51.100.4");
    assert.ok(first.ok && second.ok);
    const changed = await h.service.changePassword({ staffId: a.id, currentPassword: PASSWORD, newPassword: NEW_PASSWORD, ip: IP });
    assert.ok(changed.ok);
    assert.deepEqual(await h.service.resolveSession(first.token), { ok: false, reason: "revoked" });
    assert.deepEqual(await h.service.resolveSession(second.token), { ok: false, reason: "revoked" });
    assert.ok((await h.service.resolveSession(changed.token)).ok);
    assert.equal((await login(h, a.email, PASSWORD)).ok, false, "the old password no longer works");
    assert.ok((await login(h, a.email, NEW_PASSWORD)).ok);
  });

  it("a wrong current password is refused and counts toward the lock", async () => {
    const h = harness();
    const a = await h.account();
    for (let i = 1; i <= 4; i += 1) {
      const r = await h.service.changePassword({ staffId: a.id, currentPassword: "not-it-not-it", newPassword: NEW_PASSWORD, ip: IP });
      assert.equal(r.ok === false && r.reason, "invalid_current", `attempt ${i}`);
    }
    const fifth = await h.service.changePassword({ staffId: a.id, currentPassword: "not-it-not-it", newPassword: NEW_PASSWORD, ip: IP });
    assert.equal(fifth.ok === false && fifth.reason, "locked");
    assert.equal((await login(h, a.email, PASSWORD)).ok, false, "and the account is locked for signing in too");
  });

  it("refuses a weak or unchanged password before doing any hashing", async () => {
    const h = harness();
    const a = await h.account();
    for (const weak of ["short", PASSWORD, "            ", "x".repeat(200)]) {
      const r = await h.service.changePassword({ staffId: a.id, currentPassword: PASSWORD, newPassword: weak, ip: IP });
      assert.equal(r.ok === false && r.reason, "weak");
    }
    assert.equal(h.calls.verify, 0);
    assert.equal(h.calls.hash, 0);
  });
});

describe("a plaintext password never appears anywhere", () => {
  it("not in a result, a log line, the store, a thrown error or the console", async () => {
    const consoleLines: string[] = [];
    const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const name of ["log", "error", "warn", "info"] as const) {
      console[name] = (...args: unknown[]) => void consoleLines.push(args.map(String).join(" "));
    }
    const collected: string[] = [];
    try {
      const h = harness();
      const a = await h.account({ password: CANARY_PASSWORD, email: "real.person@example.test" });
      const results: unknown[] = [];
      results.push(await login(h, a.email, CANARY_PASSWORD + "x")); // wrong, but contains the canary
      results.push(await login(h, "real.person@example.test", CANARY_PASSWORD)); // right
      results.push(await login(h, TYPED_EMAIL_CANARY, CANARY_PASSWORD)); // unknown email, canary password
      for (let i = 0; i < 6; i += 1) results.push(await login(h, a.email, CANARY_PASSWORD + i)); // into a lock
      results.push(await login(h, a.email, CANARY_PASSWORD)); // refused: locked
      h.store.now += 20 * MINUTE;
      const ok = await login(h, a.email, CANARY_PASSWORD);
      results.push(ok);
      results.push(await h.service.changePassword({ staffId: a.id, currentPassword: CANARY_PASSWORD, newPassword: CANARY_PASSWORD + "-new", ip: IP }));
      results.push(await h.service.changePassword({ staffId: a.id, currentPassword: CANARY_PASSWORD + "-wrong", newPassword: CANARY_PASSWORD + "-newer", ip: IP }));
      for (const hasher of [cheap, productionHasher]) {
        try {
          await hasher.hash("x".repeat(5000) + CANARY_PASSWORD);
        } catch (error) {
          collected.push(String(error), (error as Error).stack ?? "");
        }
      }
      collected.push(JSON.stringify(results), JSON.stringify(h.events), h.store.everythingStored());
    } finally {
      Object.assign(console, originals);
    }
    const everything = [...collected, ...consoleLines].join("\n");
    assert.ok(!everything.includes("CANARY-PASSWORD"), "the password canary leaked");
  });

  it("the log carries a reason and a staff id for a real account, and nothing identifying otherwise", async () => {
    const h = harness();
    const real = await h.account({ email: "real.person@example.test" });
    await login(h, real.email, "wrong-wrong-wrong");
    await login(h, TYPED_EMAIL_CANARY, "wrong-wrong-wrong");
    assert.deepEqual(h.events, [
      { event: "auth_login_failed", reason: "bad_password", staffId: real.id },
      { event: "auth_login_failed", reason: "unknown_account" },
    ]);
    const text = JSON.stringify(h.events);
    for (const typed of [TYPED_EMAIL_CANARY, "typo.canary", "canary-domain", "real.person", "example.test"]) {
      assert.ok(!text.includes(typed), `the log contains ${typed}`);
    }
  });

  it("a log sink that throws does not change what a sign-in does", async () => {
    const store = new MemoryStore();
    await store.addAccount({ id: "00000000-0000-4000-8000-0000000000aa", email: "a@example.test", password: PASSWORD });
    const service = createAuthService({ store, passwords: cheap, now: () => store.now, log: () => { throw new Error("sink down"); } });
    assert.ok((await service.login({ email: "a@example.test", password: PASSWORD, ip: IP })).ok);
    assert.equal((await service.login({ email: "a@example.test", password: "wrong-wrong-wrong", ip: IP })).ok, false);
  });
});
