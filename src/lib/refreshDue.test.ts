import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refreshDue } from "./refreshDue.ts";

const EVERY = 30_000;

describe("refreshDue: one shared poll that stops when the tab is hidden", () => {
  it("never refreshes a hidden tab, however long it has been", () => {
    assert.equal(refreshDue({ now: 10 * 60_000, lastRefreshAt: 0, everyMs: EVERY, visible: false }), false);
  });

  it("refreshes a visible tab once an interval has passed, and not before", () => {
    assert.equal(refreshDue({ now: 30_000, lastRefreshAt: 0, everyMs: EVERY, visible: true }), true);
    assert.equal(refreshDue({ now: 5_000, lastRefreshAt: 0, everyMs: EVERY, visible: true }), false);
    assert.equal(refreshDue({ now: 20_000, lastRefreshAt: 0, everyMs: EVERY, visible: true }), false);
  });

  it("allows for a beat that lands slightly early (beats are floored to the interval)", () => {
    assert.equal(refreshDue({ now: 26_000, lastRefreshAt: 0, everyMs: EVERY, visible: true }), true);
  });

  it("a tab that was hidden for an hour refreshes the moment it is visible again", () => {
    assert.equal(refreshDue({ now: 3_600_000, lastRefreshAt: 0, everyMs: EVERY, visible: true }), true);
  });
});
