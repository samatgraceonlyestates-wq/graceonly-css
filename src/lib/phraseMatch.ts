// Suggestions for FREE TEXT she has typed before: the destinations and purposes of the
// movement book. She will type "bank" and "site" and "GraceWaters" over and over, so the
// distinct values already used are loaded (movementStore.ts, most used first) and matched in
// the application, exactly as the roster is: no index, no extension. Pure and browser-safe.
//
// A phrase matches when EVERY typed word is the start of a different word of it, wherever it
// is ("bank" finds "First Bank, Marina"), ignoring case and accents. Phrases whose first word
// matches come first; otherwise the order given (most used first) is kept. The text she types
// is never rewritten: a suggestion only offers to fill the box.
import { isPartialOf, normaliseName } from "./rosterMatch.ts";

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
