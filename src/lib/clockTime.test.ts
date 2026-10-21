import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClockTime } from "./clockTime.ts";

const hhmm = (raw: string) => {
  const result = parseClockTime(raw);
  return result.ok ? result.hhmm : `ERROR: ${result.message}`;
};

describe("parseClockTime", () => {
  it("accepts 8:15, 08:15 and 0815, and means the same by all three", () => {
    assert.equal(hhmm("8:15"), "08:15");
    assert.equal(hhmm("08:15"), "08:15");
    assert.equal(hhmm("0815"), "08:15");
  });

  it("accepts the edges of the day and ignores surrounding spaces", () => {
    assert.equal(hhmm("00:00"), "00:00");
    assert.equal(hhmm("0000"), "00:00");
    assert.equal(hhmm("23:59"), "23:59");
    assert.equal(hhmm("  9:05 "), "09:05");
    assert.equal(hhmm("1730"), "17:30");
  });

  it("refuses everything else, and never guesses", () => {
    for (const bad of ["", "   ", "815", "8", "8:5", "8.15", "8-15", "08:15am", "8:15 pm", "8h15", "081", "08150", "1:2:3", "noon", "0815 ", "８:15x"]) {
      const result = parseClockTime(bad);
      if (bad.trim() === "0815") continue; // trimmed: valid
      assert.equal(result.ok, false, `"${bad}" must be refused`);
    }
  });

  it("refuses an hour above 23 or minutes above 59, with a message that says so", () => {
    for (const bad of ["24:00", "2400", "25:10", "08:60", "0860", "99:99"]) {
      const result = parseClockTime(bad);
      assert.equal(result.ok, false, bad);
      if (!result.ok) assert.match(result.message, /not a time of day/);
    }
  });

  it("says what shape to type when the shape is wrong, and asks for a time when empty", () => {
    const wrong = parseClockTime("815");
    assert.ok(!wrong.ok && /08:15, 8:15 or 0815/.test(wrong.message));
    const empty = parseClockTime("");
    assert.ok(!empty.ok && empty.message === "Enter a time.");
  });
});
