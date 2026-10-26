// Suggestions for FREE TEXT she has typed before: the destinations and purposes of the
// movement book. She will type "bank" and "site" and "GraceWaters" over and over, so the
// distinct values already used are loaded (movementStore.ts, most used first) and matched in
// the application, exactly as the roster is: no index, no extension. Pure and browser-safe.
//
// A phrase matches when EVERY typed word is the start of a different word of it, wherever it
// is ("bank" finds "First Bank, Marina"), ignoring case and accents. Phrases whose first word
// matches come first; otherwise the order given (most used first) is kept. A suggestion only
// offers to fill the box.
//
// DRIFT. "Bank", "bank" and "First Bank" must not become three destinations, or any report on
// movements is worthless. So what she typed is resolved against what has been used before
// (resolvePhrase), on the screen and again on the server:
//   the SAME phrase    differs from an existing one only by case or spacing ("first  bank",
//                      "FirstBank"): the EXISTING spelling is used, and the box shows it
//   a CLOSE phrase     a typo, a partial, or the same words in another order or with other
//                      punctuation (the roster's rule, rosterMatch.isClose): she is ASKED
//                      "Did you mean First Bank?", never answered for
//   a NEW phrase       nothing is near it, or she said it is something different
import { cleanDisplayName, editDistance, isClose, isPartialOf, normaliseName } from "./rosterMatch.ts";

export function suggestPhrases(query: string, phrases: readonly string[], limit = 6): string[] {
  const typed = normaliseName(query);
  if (typed === "") return [];
  const typedWords = typed.split(" ");
  const hits: { phrase: string; rank: number }[] = [];
  for (const phrase of phrases) {
    const normalised = normaliseName(phrase);
    const words = normalised === "" ? [] : normalised.split(" ");
    if (!isPartialOf(typedWords, words)) continue;
    hits.push({ phrase, rank: words[0]!.startsWith(typedWords[0]!) ? 0 : 1 });
  }
  hits.sort((a, b) => a.rank - b.rank); // stable: the given order (most used first) is kept within a rank
  const found = hits.slice(0, limit).map((hit) => hit.phrase);
  // Nothing to offer when the only match is exactly what she typed.
  return found.length === 1 && normaliseName(found[0]!) === typed ? [] : found;
}

/** Two phrases with one key differ only by case or spacing: they are the SAME phrase. */
export function phraseKey(raw: string): string {
  return cleanDisplayName(raw).replace(/\s+/g, "").toLowerCase();
}

export type PhraseMatch =
  | { kind: "empty" }
  | { kind: "same"; phrase: string }
  | { kind: "close"; candidates: string[] }
  | { kind: "none" };

/** How a typed phrase relates to the ones used before: the same one, close ones, or nothing. */
export function matchPhrase(typed: string, phrases: readonly string[]): PhraseMatch {
  const key = phraseKey(typed);
  if (key === "") return { kind: "empty" };
  const same = phrases.find((phrase) => phraseKey(phrase) === key);
  if (same !== undefined) return { kind: "same", phrase: same };
  const wanted = normaliseName(typed);
  const candidates = phrases
    .map((phrase) => ({ phrase, normalised: normaliseName(phrase) }))
    // Equal once punctuation is ignored ("First Bank, Marina" / "First Bank Marina") is close, not the same.
    .filter((entry) => entry.normalised !== "" && (entry.normalised === wanted || isClose(wanted, entry.normalised)))
    .sort((a, b) => editDistance(wanted, a.normalised) - editDistance(wanted, b.normalised))
    .map((entry) => entry.phrase);
  return candidates.length > 0 ? { kind: "close", candidates: candidates.slice(0, 3) } : { kind: "none" };
}

export interface PhraseInput {
  text: string;
  /** She has said this is something DIFFERENT from the close phrases offered. */
  confirmNew: boolean;
}

export type PhraseResolution =
  | { kind: "use"; phrase: string }
  | { kind: "confirm"; typed: string; candidates: string[] }
  | { kind: "empty" }
  | { kind: "tooLong" };

/** The phrase to store: the existing spelling when it is the same one, a question when it is close. */
export function resolvePhrase(input: PhraseInput, phrases: readonly string[], maxLength: number): PhraseResolution {
  const typed = typeof input.text === "string" ? cleanDisplayName(input.text) : "";
  if (typed === "") return { kind: "empty" };
  const match = matchPhrase(typed, phrases);
  if (match.kind === "same") return { kind: "use", phrase: match.phrase };
  if (typed.length > maxLength) return { kind: "tooLong" };
  if (match.kind === "close" && !input.confirmNew) return { kind: "confirm", typed, candidates: match.candidates };
  return { kind: "use", phrase: typed };
}
