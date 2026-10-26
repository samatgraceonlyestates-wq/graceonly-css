// Run with `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPhone, normalisePhone, PHONE_MESSAGE } from "./phoneNumber.ts";

const ok = (raw: string) => {
  const result = normalisePhone(raw);
  assert.equal(result.kind, "ok", `${raw} should be accepted`);
  return result.kind === "ok" ? result.e164 : "";
};

describe("normalisePhone", () => {
  it("takes a Nigerian number as usually written", () => {
    assert.equal(ok("0803 123 4567"), "+2348031234567");
    assert.equal(ok("08031234567"), "+2348031234567");
    assert.equal(ok("0803-123-4567"), "+2348031234567");
  });

  it("takes international forms", () => {
    assert.equal(ok("+234 803 123 4567"), "+2348031234567");
    assert.equal(ok("2348031234567"), "+2348031234567");
    assert.equal(ok("002348031234567"), "+2348031234567");
    assert.equal(ok("+44 20 7946 0958"), "+442079460958");
  });

  it("drops a trunk 0 after +234, written or not", () => {
    assert.equal(ok("+234 (0) 803 123 4567"), "+2348031234567");
    assert.equal(ok("+234 0803 123 4567"), "+2348031234567");
  });

  it("every accepted number satisfies the database's E.164 check", () => {
    for (const raw of ["0803 123 4567", "+44 20 7946 0958", "+1 (415) 555-0100", "00 33 1 23 45 67 89"]) {
      assert.match(ok(raw), /^\+[1-9][0-9]{6,14}$/);
    }
  });

  it("empty means no number", () => {
    assert.deepEqual(normalisePhone(""), { kind: "none" });
    assert.deepEqual(normalisePhone("   "), { kind: "none" });
  });

  it("refuses what it would have to guess", () => {
    for (const raw of ["803 123 4567", "12345", "0803 123 456", "+234 803 123 45", "+0 803", "call me", "0803x1234567", "+234803123456789"]) {
      assert.deepEqual(normalisePhone(raw), { kind: "invalid", message: PHONE_MESSAGE }, raw);
    }
  });

  it("formats a Nigerian number for reading back and leaves others alone", () => {
    assert.equal(formatPhone("+2348031234567"), "+234 803 123 4567");
    assert.equal(formatPhone("+442079460958"), "+442079460958");
  });
});
