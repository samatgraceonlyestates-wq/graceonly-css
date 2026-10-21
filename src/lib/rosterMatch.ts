// Matching a typed name against the roster, in the APPLICATION. The roster is 20
// to 30 people and will stay small, so it is loaded and compared in memory: no
// index, no database extension (cPanel will not install one on PostgreSQL 10), and
// this is also what makes fuzzy duplicate detection possible at all.
//
// Pure and browser-safe: the arrivals form (live suggestions and warnings) and the
// server (the authoritative check) run the SAME functions, so they cannot disagree.
//
// THE RULE FOR "CLOSE". Two names that are not equal are CLOSE when, after
// normalising both (case, accents and punctuation ignored, spaces collapsed), ANY of:
//   1. a typo apart: the whole names differ by at most 1 edit (an insert, a delete,
//      a changed letter, or two neighbouring letters swapped), or at most 2 edits
//      when the longer is 12 or more characters ("Divine Mikel" is close to
//      "Divine Mike"; "Mike Obi" is not close to "Mark Obi");
//   2. the same words in a different order ("Mike Divine" for "Divine Mike"), since
//      she may type a surname first;
//   3. one is a PARTIAL of the other: every word of the shorter is the start of a
//      different word of the longer ("Divine" or "divi mi" for "Divine Mike", "A.
//      Obi" for "Amaka Obi").
// Close is a question, never an answer: the front desk is asked "same person, or a
// different one?" and the screen never decides for her. Equal after normalising
// means the same person, with no question.
//
// Over-asking costs one click. Under-asking puts a near-duplicate on the roster, and
// every monthly total for that person is then wrong. So the rule leans to asking.

export interface RosterName {
  id: string;
  name: string;
  department: string | null;
}

/** Lower case, no accents, letters and digits only, single spaces. Used to COMPARE names, never to store them. */
export function normaliseName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The name as it is stored: composed form, no control characters, single spaces, case as typed. */
export function cleanDisplayName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(normalised: string): string[] {
  return normalised === "" ? [] : normalised.split(" ");
}

/** Edit distance where swapping two neighbouring letters counts as one edit. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 1);
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/** True if every word of `part` is the start of a DIFFERENT word of `whole`. */
function isPartialOf(part: string[], whole: string[]): boolean {
  if (part.length === 0 || part.length > whole.length) return false;
  const used = new Set<number>();
  for (const word of part) {
    const at = whole.findIndex((candidate, index) => !used.has(index) && candidate.startsWith(word));
    if (at === -1) return false;
    used.add(at);
  }
  return true;
}

/** Are two NORMALISED, unequal names close (see the rule at the top)? */
export function isClose(a: string, b: string): boolean {
  if (a === "" || b === "" || a === b) return false;
  const limit = Math.max(a.length, b.length) >= 12 ? 2 : 1;
  if (editDistance(a, b) <= limit) return true;
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.length > 1 && wa.length === wb.length && [...wa].sort().join(" ") === [...wb].sort().join(" ")) return true;
  return wa.length <= wb.length ? isPartialOf(wa, wb) : isPartialOf(wb, wa);
}

export type NameMatch =
  | { kind: "empty" }
  | { kind: "exact"; people: RosterName[] }
  | { kind: "close"; candidates: RosterName[] }
  | { kind: "none" };

/** How a typed name relates to the roster: the same person, someone close, or nobody. */
export function matchName(typed: string, roster: readonly RosterName[]): NameMatch {
  const wanted = normaliseName(typed);
  if (wanted === "") return { kind: "empty" };
  const exact = roster.filter((person) => normaliseName(person.name) === wanted);
  if (exact.length > 0) return { kind: "exact", people: exact };
  const candidates = roster
    .map((person) => ({ person, name: normaliseName(person.name) }))
    .filter((entry) => isClose(wanted, entry.name))
    .sort((x, y) => editDistance(wanted, x.name) - editDistance(wanted, y.name) || x.person.name.localeCompare(y.person.name))
    .map((entry) => entry.person);
  return candidates.length > 0 ? { kind: "close", candidates } : { kind: "none" };
}

/**
 * Suggestions while typing: a person matches when EVERY typed word is the start of
 * a different word of their name, wherever it is in the name ("obi" finds "Peter
 * Obi"). Names whose first word matches the first thing typed come first.
 */
export function suggest(query: string, roster: readonly RosterName[], limit = 6): RosterName[] {
  const typed = wordsOf(normaliseName(query));
  if (typed.length === 0) return [];
  const hits: { person: RosterName; rank: number }[] = [];
  for (const person of roster) {
    const words = wordsOf(normaliseName(person.name));
    if (!isPartialOf(typed, words)) continue;
    hits.push({ person, rank: words[0]!.startsWith(typed[0]!) ? 0 : 1 });
  }
  hits.sort((x, y) => x.rank - y.rank || x.person.name.localeCompare(y.person.name));
  return hits.slice(0, limit).map((hit) => hit.person);
}
