// Two small in-memory limiters for the sign-in path. Pure; the clock is injected.
//
// IN MEMORY, PER PROCESS. They are not shared between processes and reset on a
// restart. That is the honest limit of doing this without another table: on a
// host that runs several Node processes each keeps its own count, so an attacker
// gets that many times the budget. The PER-ACCOUNT lock is different: it lives in
// the staff row, so it holds across processes and restarts. If the host turns out
// to run several processes, move these two into the database (a new migration).

export interface Clock {
  (): number; // milliseconds since the epoch
}

/**
 * IP limiter: at most `limit` failures per key in a sliding window.
 * Only FAILURES are recorded, and a success does not clear them, so a stolen valid
 * account cannot be used to wipe the count while guessing others.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: Clock;

  constructor(options: { limit: number; windowMs: number; maxKeys?: number; now?: Clock }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  private fresh(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }

  isBlocked(key: string): boolean {
    return this.fresh(key).length >= this.limit;
  }

  /** Seconds until the oldest counted failure leaves the window, or 0 if not blocked. */
  retryAfterSeconds(key: string): number {
    const kept = this.fresh(key);
    if (kept.length < this.limit) return 0;
    const first = kept[0] ?? this.now();
    return Math.max(1, Math.ceil((first + this.windowMs - this.now()) / 1000));
  }

  recordFailure(key: string): void {
    const kept = this.fresh(key);
    kept.push(this.now());
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      // Bounded memory: drop the oldest-inserted key rather than grow without limit.
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    this.hits.set(key, kept);
  }
}

/**
 * The same lock the staff row applies, for an email that matches NO account.
 * Without it, "locked out after five tries" would only ever happen for real
 * accounts, and trying an address until it locks would prove it exists.
 * Mirrors the database rule exactly: `lockAfter` failures lock for `lockMs`, the
 * count restarts when the lock is applied, attempts during a lock change nothing.
 * Keys are hashes of the typed email, never the email.
 */
export class SimulatedLockout {
  private readonly state = new Map<string, { failures: number; lockedUntil: number }>();
  private readonly lockAfter: number;
  private readonly lockMs: number;
  private readonly maxKeys: number;
  private readonly now: Clock;

  constructor(options: { lockAfter: number; lockMs: number; maxKeys?: number; now?: Clock }) {
    this.lockAfter = options.lockAfter;
    this.lockMs = options.lockMs;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  isLocked(key: string): boolean {
    const entry = this.state.get(key);
    return entry !== undefined && entry.lockedUntil > this.now();
  }

  /** Returns true if this failure left the key locked. */
  recordFailure(key: string): boolean {
    const entry = this.state.get(key) ?? { failures: 0, lockedUntil: 0 };
    if (entry.lockedUntil > this.now()) return true; // already locked: nothing changes
    entry.failures += 1;
    if (entry.failures >= this.lockAfter) {
      entry.failures = 0;
      entry.lockedUntil = this.now() + this.lockMs;
    }
    if (!this.state.has(key) && this.state.size >= this.maxKeys) {
      const oldest = this.state.keys().next().value;
      if (oldest !== undefined) this.state.delete(oldest);
    }
    this.state.set(key, entry);
    return entry.lockedUntil > this.now();
  }

  lockedForSeconds(key: string): number {
    const entry = this.state.get(key);
    if (entry === undefined || entry.lockedUntil <= this.now()) return 0;
    return Math.max(1, Math.ceil((entry.lockedUntil - this.now()) / 1000));
  }
}
