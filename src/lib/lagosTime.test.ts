// Lagos day boundaries. Pure. Run: npm test
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LAGOS_TIME_ZONE, lagosDateOf, lagosDayRange, lagosDaysRange } from "./lagosTime.ts";

const iso = (date: Date) => date.toISOString();

describe("a Lagos day", () => {
  it("2026-10-16 runs from 23:00 UTC on the 15th to 23:00 UTC on the 16th (Lagos is UTC+1)", () => {
    const range = lagosDayRange("2026-10-16");
    assert.equal(range.date, "2026-10-16");
    assert.equal(iso(range.start), "2026-10-15T23:00:00.000Z");
    assert.equal(iso(range.end), "2026-10-16T23:00:00.000Z");
  });

  it("is half-open: the last instant of the day is inside, the first of the next is not", () => {
    const range = lagosDayRange("2026-10-16");
    const inside = (instant: string) => new Date(instant) >= range.start && new Date(instant) < range.end;
    assert.ok(!inside("2026-10-15T22:59:59.999Z"), "23:59:59.999 in Lagos on the 15th");
    assert.ok(inside("2026-10-15T23:00:00.000Z"), "00:00:00 in Lagos on the 16th");
    assert.ok(inside("2026-10-16T22:59:59.999Z"), "23:59:59.999 in Lagos on the 16th");
    assert.ok(!inside("2026-10-16T23:00:00.000Z"), "00:00:00 in Lagos on the 17th");
  });

  it("an evening clock-in in Lagos belongs to that Lagos day, not the UTC one", () => {
    // 23:30 UTC on the 15th is 00:30 on the 16th in Lagos.
    assert.equal(lagosDateOf(new Date("2026-10-15T23:30:00Z")), "2026-10-16");
    assert.equal(lagosDateOf(new Date("2026-10-15T22:59:59.999Z")), "2026-10-15");
    assert.equal(lagosDateOf(new Date("2026-10-15T23:00:00.000Z")), "2026-10-16");
    assert.equal(lagosDateOf(new Date("2026-10-16T22:59:59.999Z")), "2026-10-16");
    assert.equal(lagosDateOf(new Date("2026-10-16T23:00:00.000Z")), "2026-10-17");
  });

  it("accepts an instant and returns the range of the Lagos day it falls in", () => {
    const range = lagosDayRange(new Date("2026-10-15T23:30:00Z"));
    assert.equal(range.date, "2026-10-16");
    assert.equal(iso(range.start), "2026-10-15T23:00:00.000Z");
  });

  it("handles month ends, a leap day and the year end", () => {
    assert.equal(iso(lagosDayRange("2026-02-28").end), "2026-02-28T23:00:00.000Z");
    assert.equal(iso(lagosDayRange("2028-02-29").start), "2028-02-28T23:00:00.000Z");
    assert.equal(iso(lagosDayRange("2028-02-29").end), "2028-02-29T23:00:00.000Z");
    assert.equal(iso(lagosDayRange("2026-12-31").end), "2026-12-31T23:00:00.000Z");
    assert.equal(iso(lagosDayRange("2027-01-01").start), "2026-12-31T23:00:00.000Z");
  });

  it("days tile the timeline: each ends exactly where the next begins, for two years", () => {
    let date = "2026-01-01";
    for (let i = 0; i < 731; i += 1) {
      const range = lagosDayRange(date);
      const next = lagosDayRange(lagosDateOf(range.end));
      assert.equal(range.end.getTime(), next.start.getTime(), date);
      assert.equal(lagosDateOf(range.start), date);
      assert.equal(lagosDateOf(new Date(range.end.getTime() - 1)), date);
      date = next.date;
    }
    assert.equal(date, "2028-01-02");
  });
});

describe("several days at once", () => {
  it("Monday to Friday of a week is one range from the first start to the last end", () => {
    const week = lagosDaysRange("2026-10-12", "2026-10-16");
    assert.equal(week.first, "2026-10-12");
    assert.equal(week.last, "2026-10-16");
    assert.equal(iso(week.start), "2026-10-11T23:00:00.000Z");
    assert.equal(iso(week.end), "2026-10-16T23:00:00.000Z");
  });

  it("one day is the same as lagosDayRange", () => {
    const one = lagosDaysRange("2026-10-16", "2026-10-16");
    const day = lagosDayRange("2026-10-16");
    assert.equal(one.start.getTime(), day.start.getTime());
    assert.equal(one.end.getTime(), day.end.getTime());
  });

  it("refuses a last day before the first", () => {
    assert.throws(() => lagosDaysRange("2026-10-16", "2026-10-12"), RangeError);
  });
});

describe("bad input", () => {
  it("refuses anything that is not a real YYYY-MM-DD date", () => {
    for (const bad of ["", "2026-1-1", "16/10/2026", "2026-10-16T00:00:00Z", "2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31", "2027-02-29", " 2026-10-16"]) {
      assert.throws(() => lagosDayRange(bad), RangeError, JSON.stringify(bad));
    }
  });

  it("refuses an invalid Date", () => {
    assert.throws(() => lagosDateOf(new Date("not a date")), RangeError);
    assert.throws(() => lagosDayRange(new Date(Number.NaN)), RangeError);
  });

  it("names the zone it uses", () => {
    assert.equal(LAGOS_TIME_ZONE, "Africa/Lagos");
  });
});

describe("it does not depend on the time zone of the machine it runs on", () => {
  it("gives identical answers under very different TZ settings", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const directory = mkdtempSync(join(tmpdir(), "lagos-"));
    try {
      const script = join(directory, "probe.ts");
      writeFileSync(
        script,
        `import { lagosDateOf, lagosDayRange, lagosDaysRange } from ${JSON.stringify(pathToFileURL(join(here, "lagosTime.ts")).href)};
const out = {
  a: lagosDateOf(new Date("2026-10-15T23:30:00Z")),
  b: lagosDateOf(new Date("2026-10-16T22:59:59.999Z")),
  c: lagosDayRange("2026-10-16"),
  d: lagosDayRange(new Date("2026-01-01T00:30:00Z")),
  e: lagosDaysRange("2026-10-12", "2026-10-16"),
  f: lagosDayRange("2028-02-29"),
};
console.log(JSON.stringify(out));
`,
      );
      const outputs = new Map<string, string>();
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata", "Pacific/Auckland", "Africa/Lagos"]) {
        const result = spawnSync(
          process.execPath,
          ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script],
          { env: { ...process.env, TZ: tz }, encoding: "utf8" },
        );
        assert.equal(result.status, 0, `${tz}: ${result.stderr}`);
        outputs.set(tz, result.stdout.trim());
      }
      const distinct = new Set(outputs.values());
      assert.equal(distinct.size, 1, `answers differ by TZ: ${JSON.stringify([...outputs])}`);
      const parsed = JSON.parse([...distinct][0] ?? "{}") as { a: string; c: { start: string; end: string } };
      assert.equal(parsed.a, "2026-10-16");
      assert.equal(parsed.c.start, "2026-10-15T23:00:00.000Z");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
