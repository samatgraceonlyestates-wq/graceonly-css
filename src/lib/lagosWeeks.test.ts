// Lagos time of day, weeks and months. Pure. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lagosAddDays,
  lagosDateOf,
  lagosInstantAt,
  lagosMonthOf,
  lagosSecondsOfDay,
  lagosWeekdayIndex,
  lagosWeekOf,
} from "./lagosTime.ts";

const iso = (date: Date) => date.toISOString();

describe("seconds into the Lagos day", () => {
  it("is measured on the Lagos clock, not the UTC one", () => {
    assert.equal(lagosSecondsOfDay(new Date("2026-10-16T08:14:59Z")), 9 * 3600 + 14 * 60 + 59); // 09:14:59 in Lagos
    assert.equal(lagosSecondsOfDay(new Date("2026-10-16T08:15:00Z")), 9 * 3600 + 15 * 60); // 09:15:00
    assert.equal(lagosSecondsOfDay(new Date("2026-10-16T08:15:01Z")), 9 * 3600 + 15 * 60 + 1);
  });

  it("wraps at Lagos midnight, which is 23:00 UTC", () => {
    assert.equal(lagosSecondsOfDay(new Date("2026-10-15T22:59:59Z")), 86399);
    assert.equal(lagosSecondsOfDay(new Date("2026-10-15T23:00:00Z")), 0);
  });
});

describe("the instant a Lagos time occurs on a Lagos date", () => {
  it("09:15 on 2026-10-16 in Lagos is 08:15 UTC", () => {
    assert.equal(iso(lagosInstantAt("2026-10-16", "09:15")), "2026-10-16T08:15:00.000Z");
  });

  it("00:30 Lagos belongs to the date after the UTC one", () => {
    assert.equal(iso(lagosInstantAt("2026-10-16", "00:30")), "2026-10-15T23:30:00.000Z");
  });

  it("round-trips through lagosDateOf and lagosSecondsOfDay", () => {
    for (const [date, hhmm] of [["2026-01-01", "00:00"], ["2026-12-31", "23:59"], ["2028-02-29", "09:15"], ["2026-10-16", "12:00"]] as const) {
      const instant = lagosInstantAt(date, hhmm);
      assert.equal(lagosDateOf(instant), date);
      const [h, m] = hhmm.split(":").map(Number);
      assert.equal(lagosSecondsOfDay(instant), (h ?? 0) * 3600 + (m ?? 0) * 60);
    }
  });

  it("refuses a time that is not HH:MM", () => {
    for (const bad of ["9:15", "24:00", "09:60", "09:15:00", "", "nine"]) assert.throws(() => lagosInstantAt("2026-10-16", bad), RangeError, bad);
  });
});

describe("calendar arithmetic", () => {
  it("adds and subtracts days across months, years and a leap day", () => {
    assert.equal(lagosAddDays("2026-10-31", 1), "2026-11-01");
    assert.equal(lagosAddDays("2026-12-31", 1), "2027-01-01");
    assert.equal(lagosAddDays("2028-02-28", 1), "2028-02-29");
    assert.equal(lagosAddDays("2028-03-01", -1), "2028-02-29");
    assert.equal(lagosAddDays("2026-10-16", -16), "2026-09-30");
  });

  it("numbers the weekday Monday first", () => {
    assert.equal(lagosWeekdayIndex("2026-10-12"), 0); // a Monday
    assert.equal(lagosWeekdayIndex("2026-10-16"), 4); // a Friday
    assert.equal(lagosWeekdayIndex("2026-10-18"), 6); // a Sunday
  });

  it("finds the Monday to Sunday week, including one that spans two months", () => {
    assert.deepEqual(lagosWeekOf("2026-10-16"), { first: "2026-10-12", last: "2026-10-18" });
    assert.deepEqual(lagosWeekOf("2026-10-12"), { first: "2026-10-12", last: "2026-10-18" });
    assert.deepEqual(lagosWeekOf("2026-10-18"), { first: "2026-10-12", last: "2026-10-18" });
    assert.deepEqual(lagosWeekOf("2026-10-01"), { first: "2026-09-28", last: "2026-10-04" });
  });

  it("finds the calendar month, including February in a leap year", () => {
    assert.deepEqual(lagosMonthOf("2026-10-16"), { first: "2026-10-01", last: "2026-10-31" });
    assert.deepEqual(lagosMonthOf("2026-02-10"), { first: "2026-02-01", last: "2026-02-28" });
    assert.deepEqual(lagosMonthOf("2028-02-10"), { first: "2028-02-01", last: "2028-02-29" });
    assert.deepEqual(lagosMonthOf("2026-12-31"), { first: "2026-12-01", last: "2026-12-31" });
  });

  it("refuses a date that is not a real calendar date", () => {
    for (const bad of ["2026-02-30", "nope", "2026-13-01"]) {
      assert.throws(() => lagosWeekOf(bad), RangeError);
      assert.throws(() => lagosMonthOf(bad), RangeError);
      assert.throws(() => lagosAddDays(bad, 1), RangeError);
    }
  });
});
