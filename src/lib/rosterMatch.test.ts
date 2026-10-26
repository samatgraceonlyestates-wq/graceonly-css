import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanDisplayName, editDistance, isClose, matchesFilter, matchName, normaliseName, type RosterName, suggest } from "./rosterMatch.ts";

const person = (id: string, name: string, department: string | null = null): RosterName => ({ id, name, department });
const ROSTER = [
  person("1", "Divine Mike", "Front desk"),
  person("2", "Peter Obi", "Admin"),
  person("3", "Amaka Obi", "Legal"),
  person("4", "Chukwuemeka Eze"),
  person("5", "Mark Obi"),
  person("6", "Faith Udo", "Partners"),
];
const names = (list: RosterName[]) => list.map((entry) => entry.name);

describe("normaliseName", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    assert.equal(normaliseName("  Dívine   MIKE "), "divine mike");
    assert.equal(normaliseName("O'Brien-Smith"), "o brien smith");
    assert.equal(normaliseName("A. Obi"), "a obi");
  });
  it("cleanDisplayName keeps the case as typed and only tidies spacing", () => {
    assert.equal(cleanDisplayName("  divine \t mike\u0000 "), "divine mike");
  });
});

describe("editDistance", () => {
  it("counts a swap of neighbouring letters as one edit", () => {
    assert.equal(editDistance("mike", "mkie"), 1);
    assert.equal(editDistance("mike", "mikel"), 1);
    assert.equal(editDistance("mike", "mark"), 3);
    assert.equal(editDistance("", "abc"), 3);
  });
});

describe("suggest: matching on any word, not just the start", () => {
  it('"divi" offers "Divine Mike"', () => {
    assert.deepEqual(names(suggest("divi", ROSTER)), ["Divine Mike"]);
  });
  it("finds a person by surname typed first or alone", () => {
    assert.deepEqual(names(suggest("obi", ROSTER)), ["Amaka Obi", "Mark Obi", "Peter Obi"]);
    assert.deepEqual(names(suggest("obi pet", ROSTER)), ["Peter Obi"]);
    assert.deepEqual(names(suggest("mike div", ROSTER)), ["Divine Mike"]);
  });
  it("puts a first-word match ahead of a later-word match", () => {
    const roster = [person("a", "Peter Mike"), person("b", "Mike Peters")];
    assert.deepEqual(names(suggest("mi", roster)), ["Mike Peters", "Peter Mike"]);
  });
  it("offers nothing for nothing, and caps the list", () => {
    assert.deepEqual(suggest("", ROSTER), []);
    assert.deepEqual(suggest("   ", ROSTER), []);
    assert.deepEqual(suggest("zzz", ROSTER), []);
    const many = Array.from({ length: 20 }, (_, i) => person(String(i), `Ada ${String.fromCharCode(65 + i)}`));
    assert.equal(suggest("ada", many).length, 6);
  });
  it("does not use one word of a name for two typed words", () => {
    assert.deepEqual(suggest("obi obi", ROSTER), []);
  });
});

describe("isClose: the rule", () => {
  it("one typo is close, whichever way", () => {
    assert.ok(isClose("divine mikel", "divine mike")); // extra letter
    assert.ok(isClose("divine mik", "divine mike")); // missing letter
    assert.ok(isClose("divine mkie", "divine mike")); // swapped letters
    assert.ok(isClose("faith udo", "faith udoh"));
  });
  it("two typos are close only in a long name", () => {
    assert.ok(!isClose("mike obi", "mark obi"), "short names: 2 edits are different people");
    assert.ok(isClose("chukwuemeka eze", "chukwuemeke ezee"), "12+ characters: 2 edits are close");
  });
  it("the same words in another order are close", () => {
    assert.ok(isClose("mike divine", "divine mike"));
  });
  it("a partial name is close, including initials", () => {
    assert.ok(isClose("divine", "divine mike"));
    assert.ok(isClose("divi mi", "divine mike"));
    assert.ok(isClose("a obi", "amaka obi"));
    assert.ok(isClose("divine mike obi", "divine mike"), "a fuller name than the roster has");
  });
  it("different people are not close", () => {
    assert.ok(!isClose("ada obi", "amaka obi"));
    assert.ok(!isClose("peter obi", "peter eze"));
    assert.ok(!isClose("grace nkem", "divine mike"));
  });
  it("equal or empty is not close: equal is the same person, with no question", () => {
    assert.ok(!isClose("divine mike", "divine mike"));
    assert.ok(!isClose("", "divine mike"));
  });
});

describe("matchName", () => {
  it("equal after normalising is the same person", () => {
    const m = matchName("  divine   MIKE ", ROSTER);
    assert.equal(m.kind, "exact");
    assert.deepEqual(m.kind === "exact" ? names(m.people) : [], ["Divine Mike"]);
  });
  it('"Divine Mikel" against "Divine Mike" needs confirming', () => {
    const m = matchName("Divine Mikel", ROSTER);
    assert.equal(m.kind, "close");
    assert.deepEqual(m.kind === "close" ? names(m.candidates) : [], ["Divine Mike"]);
  });
  it("a name nobody is near is new", () => {
    assert.deepEqual(matchName("Grace Nkem", ROSTER), { kind: "none" });
  });
  it("blank is empty", () => {
    assert.deepEqual(matchName("  ", ROSTER), { kind: "empty" });
  });
  it("lists the nearest first", () => {
    const m = matchName("Obi", ROSTER);
    assert.equal(m.kind, "close");
    assert.equal(m.kind === "close" ? m.candidates.length : 0, 3);
  });
});

import { personDetails } from "./rosterMatch.ts";

describe("personDetails: telling two people of one name apart", () => {
  it("a unique name shows just the department", () => {
    const details = personDetails([person("1", "Divine Mike", "Front desk"), person("2", "Peter Obi")]);
    assert.equal(details.get("1"), "Front desk");
    assert.equal(details.get("2"), "");
  });

  it("two people with one name are told apart by department and when they were added", () => {
    const details = personDetails([
      { id: "a", name: "Ada Okafor", department: "Legal", since: "2026-03-02" },
      { id: "b", name: "ada  OKAFOR", department: "Finance", since: "2026-10-12" },
    ]);
    assert.equal(details.get("a"), "Legal · added 2 Mar 2026");
    assert.equal(details.get("b"), "Finance · added 12 Oct 2026");
  });

  it("a missing department is said so, and added-on tells them apart", () => {
    const details = personDetails([
      { id: "a", name: "Ada Okafor", department: null, since: "2026-03-02" },
      { id: "b", name: "Ada Okafor", department: null, since: "2026-10-12" },
    ]);
    assert.equal(details.get("a"), "no department · added 2 Mar 2026");
    assert.notEqual(details.get("a"), details.get("b"));
  });

  it("when even those are the same, they are numbered, so they can still be chosen", () => {
    const details = personDetails([
      { id: "a", name: "Ada Okafor", department: "Legal", since: "2026-10-12" },
      { id: "b", name: "Ada Okafor", department: "Legal", since: "2026-10-12" },
    ]);
    const labels = [details.get("a"), details.get("b")].sort();
    assert.deepEqual(labels, ["Legal · added 12 Oct 2026 · 1 of 2", "Legal · added 12 Oct 2026 · 2 of 2"]);
  });

  it("every person of a shared name gets a label that is unique within the group", () => {
    const group = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: "Ada Okafor", department: i < 2 ? "Legal" : "Finance", since: "2026-10-12" }));
    const labels = [...personDetails(group).values()];
    assert.equal(new Set(labels).size, 4);
  });
});

describe("matchesFilter (the board's filter box)", () => {
  it("matches any word of the name, from its start, ignoring case and accents", () => {
    assert.equal(matchesFilter("obi", "Peter Obi"), true);
    assert.equal(matchesFilter("OBI", "Amaka Obi-Eze"), true);
    assert.equal(matchesFilter("am ob", "Amaka Obi"), true);
    assert.equal(matchesFilter("ade", "Adébáyọ̀ Cole"), true);
  });

  it("needs every typed word, and the start of a word", () => {
    assert.equal(matchesFilter("eter", "Peter Obi"), false);
    assert.equal(matchesFilter("peter mike", "Peter Obi"), false);
  });

  it("nothing typed matches everyone", () => {
    assert.equal(matchesFilter("", "Peter Obi"), true);
    assert.equal(matchesFilter("   ", "Peter Obi"), true);
  });
});
