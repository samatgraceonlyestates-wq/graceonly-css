import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestPhrases } from "./phraseMatch.ts";

// Most used first, as movementStore.ts returns them.
const USED = ["Bank", "First Bank, Marina", "Site", "GraceWaters Estate", "Court", "Federal Land Registry", "Site inspection"];

describe("suggestPhrases", () => {
  it('"bank" finds both banks, the plain one first (most used first, first-word match first)', () => {
    assert.deepEqual(suggestPhrases("bank", USED), ["Bank", "First Bank, Marina"]);
  });

  it("matches any word of a phrase, ignoring case", () => {
    assert.deepEqual(suggestPhrases("MARINA", USED), ["First Bank, Marina"]);
    assert.deepEqual(suggestPhrases("grace", USED), ["GraceWaters Estate"]);
    assert.deepEqual(suggestPhrases("reg", USED), ["Federal Land Registry"]);
  });

  it("needs EVERY typed word to start a different word of the phrase", () => {
    assert.deepEqual(suggestPhrases("land reg", USED), ["Federal Land Registry"]);
    assert.deepEqual(suggestPhrases("site site", USED), []);
    assert.deepEqual(suggestPhrases("site insp", USED), ["Site inspection"]);
  });

  it("offers nothing for nothing, for no match, or when the only match is exactly what was typed", () => {
    assert.deepEqual(suggestPhrases("", USED), []);
    assert.deepEqual(suggestPhrases("   ", USED), []);
    assert.deepEqual(suggestPhrases("zzz", USED), []);
    assert.deepEqual(suggestPhrases("court", USED), []);
  });

  it("keeps the order given within a rank, and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Site ${i}`);
    assert.equal(suggestPhrases("site", many).length, 6);
    assert.equal(suggestPhrases("site", many)[0], "Site 0");
  });
});
