// The in-memory limiters. Pure. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SimulatedLockout, SlidingWindowLimiter } from "./failureLimiter.ts";

const MINUTE = 60_000;

describe("SlidingWindowLimiter", () => {
  it("blocks at the limit and not before", () => {
    const now = 0;
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 15 * MINUTE, now: () => now });
    limiter.recordFailure("a");
    limiter.recordFailure("a");
    assert.equal(limiter.isBlocked("a"), false);
    limiter.recordFailure("a");
    assert.equal(limiter.isBlocked("a"), true);
    assert.equal(limiter.isBlocked("b"), false);
  });

  it("forgets failures as the window slides", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 10 * MINUTE, now: () => now });
    limiter.recordFailure("a");
    now = 4 * MINUTE;
    limiter.recordFailure("a");
    assert.equal(limiter.isBlocked("a"), true);
    assert.equal(limiter.retryAfterSeconds("a"), 6 * 60);
    now = 10 * MINUTE + 1;
    assert.equal(limiter.isBlocked("a"), false, "the first failure has left the window");
    assert.equal(limiter.retryAfterSeconds("a"), 0);
  });

  it("holds a bounded number of keys", () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: MINUTE, maxKeys: 3, now: () => 0 });
    for (const key of ["a", "b", "c", "d"]) limiter.recordFailure(key);
    assert.equal(limiter.isBlocked("a"), false, "the oldest key was dropped to stay within the bound");
    assert.equal(limiter.isBlocked("d"), true);
  });
});

describe("SimulatedLockout mirrors the staff row's rule", () => {
  const make = () => {
    const clock = { now: 0 };
    const lockout = new SimulatedLockout({ lockAfter: 5, lockMs: 15 * MINUTE, now: () => clock.now });
    return { clock, lockout };
  };

  it("locks on the fifth failure and not before", () => {
    const { lockout } = make();
    for (let i = 1; i <= 4; i += 1) assert.equal(lockout.recordFailure("k"), false, `failure ${i}`);
    assert.equal(lockout.recordFailure("k"), true);
    assert.equal(lockout.isLocked("k"), true);
    assert.equal(lockout.lockedForSeconds("k"), 15 * 60);
  });

  it("attempts during the lock change nothing", () => {
    const { clock, lockout } = make();
    for (let i = 0; i < 5; i += 1) lockout.recordFailure("k");
    clock.now = 10 * MINUTE;
    assert.equal(lockout.recordFailure("k"), true);
    assert.equal(lockout.lockedForSeconds("k"), 5 * 60, "not extended");
  });

  it("restarts the count after the lock lapses", () => {
    const { clock, lockout } = make();
    for (let i = 0; i < 5; i += 1) lockout.recordFailure("k");
    clock.now = 15 * MINUTE + 1;
    assert.equal(lockout.isLocked("k"), false);
    assert.equal(lockout.recordFailure("k"), false, "the first failure after a lock is just the first");
  });

  it("keeps keys apart", () => {
    const { lockout } = make();
    for (let i = 0; i < 5; i += 1) lockout.recordFailure("one");
    assert.equal(lockout.isLocked("two"), false);
  });
});
