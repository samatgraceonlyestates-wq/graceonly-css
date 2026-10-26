import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchPhrase, phraseKey, resolvePhrase, suggestPhrases } from "./phraseMatch.ts";

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

describe("matchPhrase and resolvePhrase: no drift", () => {
  const resolve = (text: string, confirmNew = false) => resolvePhrase({ text, confirmNew }, USED, 100);

  it("differs only by case or spacing: the EXISTING spelling is used, without a question", () => {
    assert.deepEqual(resolve("bank"), { kind: "use", phrase: "Bank" });
    assert.deepEqual(resolve("  BANK  "), { kind: "use", phrase: "Bank" });
    assert.deepEqual(resolve("first bank,  marina"), { kind: "use", phrase: "First Bank, Marina" });
    assert.deepEqual(resolve("Gracewaters estate"), { kind: "use", phrase: "GraceWaters Estate" });
    // Spacing includes a space too few: "FirstBank" is "First Bank".
    assert.deepEqual(resolvePhrase({ text: "FirstBank", confirmNew: false }, ["First Bank"], 100), { kind: "use", phrase: "First Bank" });
    // Even when she said "different": the same phrase is the same phrase.
    assert.deepEqual(resolve("bank", true), { kind: "use", phrase: "Bank" });
  });

  it("a genuinely close spelling is a QUESTION that offers the existing one", () => {
    assert.deepEqual(resolve("Bnak"), { kind: "confirm", typed: "Bnak", candidates: ["Bank"] });
    assert.deepEqual(resolve("Frist Bank, Marina").kind, "confirm");
    // A partial: "First Bank" is close to "First Bank, Marina" (the owner's own example of drift).
    const partial = resolve("First Bank");
    assert.equal(partial.kind, "confirm");
    assert.ok(partial.kind === "confirm" && partial.candidates.includes("First Bank, Marina"));
    // Other punctuation, same words: close, not silently the same.
    assert.deepEqual(resolve("First Bank Marina").kind, "confirm");
    assert.deepEqual(resolve("Site inspections").kind, "confirm");
  });

  it("she can say it is different, and then it is stored as she typed it (spacing tidied, case kept)", () => {
    assert.deepEqual(resolve("Bnak", true), { kind: "use", phrase: "Bnak" });
    assert.deepEqual(resolve("  Zenith   Bank ", true), { kind: "use", phrase: "Zenith Bank" });
  });

  it("nothing near it is simply new; empty and too long are refused", () => {
    assert.deepEqual(resolve("Ministry of Lands"), { kind: "use", phrase: "Ministry of Lands" });
    assert.deepEqual(resolve("   "), { kind: "empty" });
    assert.deepEqual(resolvePhrase({ text: "x".repeat(101), confirmNew: true }, USED, 100), { kind: "tooLong" });
  });

  it("offers at most three, nearest first", () => {
    const match = matchPhrase("Sit", ["Site", "Site inspection", "Site visit", "Site meeting"]);
    assert.equal(match.kind, "close");
    assert.ok(match.kind === "close" && match.candidates.length === 3 && match.candidates[0] === "Site");
  });

  it("the key ignores case and every space, nothing else", () => {
    assert.equal(phraseKey(" First  Bank "), "firstbank");
    assert.notEqual(phraseKey("First Bank, Marina"), phraseKey("First Bank Marina"));
  });
});
