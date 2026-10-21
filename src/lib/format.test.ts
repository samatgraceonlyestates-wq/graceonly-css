import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLongDate } from "./format.ts";

describe("formatLongDate: the day in words, so it cannot be misread", () => {
  it("spells out the weekday, day, month and year", () => {
    assert.equal(formatLongDate("2026-10-21"), "Wednesday, 21 October 2026");
    assert.equal(formatLongDate("2026-10-16"), "Friday, 16 October 2026");
    assert.equal(formatLongDate("2026-12-10"), "Thursday, 10 December 2026");
  });

  it("10/21/2026 read day-first is the 10th of December: the two are never confused", () => {
    assert.notEqual(formatLongDate("2026-10-21"), formatLongDate("2026-12-10"));
  });

  it("gets Mondays, Sundays and leap days right", () => {
    assert.equal(formatLongDate("2026-10-19"), "Monday, 19 October 2026");
    assert.equal(formatLongDate("2026-10-25"), "Sunday, 25 October 2026");
    assert.equal(formatLongDate("2028-02-29"), "Tuesday, 29 February 2028");
  });

  it("is empty for anything that is not a real calendar date", () => {
    for (const bad of ["", "21/10/2026", "2026-13-01", "2026-02-30", "2026-10-32", "yesterday", "2026-1-5"]) {
      assert.equal(formatLongDate(bad), "", bad);
    }
  });
});
