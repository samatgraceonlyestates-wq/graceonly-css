// Turning a typed name into a person: the ONE implementation, used by the arrivals sheet
// (who arrived) and the movement book (who approved a movement). Pure and browser-safe.
// It never decides for the front desk: a close name is a question, never an answer.
//
//   the picked person  she chose a suggestion and has not edited the name since
//   an exact match     equal after normalising (case, accents, punctuation): the same person
//   a close name       the names a typo or a partial away: she must say whether it is the same
//                      person or a different one, and the existing person is OFFERED
//   a new name         nobody is near it, or she confirmed it is a different person
//
// The capitalisation of a typed name is never changed (CLAUDE.md): comparison ignores case,
// storage keeps it as typed.
import { cleanDisplayName, matchName, normaliseName, type RosterName } from "./rosterMatch.ts";

export const NAME_MAX_LENGTH = 100;

export interface NameInput {
  /** The name as typed (or as filled in from a suggestion). */
  name: string;
  /** Set when she picked a suggestion; honoured only while the name still matches that person. */
  personId: string | null;
  /** She has said this name is a DIFFERENT person from the close ones shown. */
  confirmNew: boolean;
}

export type NameResolution =
  | { kind: "person"; person: RosterName }
  | { kind: "create"; name: string }
  | { kind: "confirm"; typed: string; candidates: RosterName[] }
  | { kind: "problem"; message: string };

export function resolveName(input: NameInput, pool: readonly RosterName[], maxLength = NAME_MAX_LENGTH): NameResolution {
  const typed = cleanDisplayName(input.name);
  if (typed === "") return { kind: "problem", message: "Enter a name." };
  if (typed.length > maxLength) return { kind: "problem", message: `Keep the name under ${maxLength} characters.` };

  // A picked suggestion counts only while the name still IS that person's name.
  const picked = input.personId === null ? undefined : pool.find((candidate) => candidate.id === input.personId);
  if (picked !== undefined && normaliseName(picked.name) === normaliseName(typed)) return { kind: "person", person: picked };

  const match = matchName(typed, pool);
  if (match.kind === "exact") {
    if (match.people.length > 1) {
      return { kind: "problem", message: `More than one person is called ${typed}. Pick the right one from the list.` };
    }
    return { kind: "person", person: match.people[0]! };
  }
  if (match.kind === "close" && !input.confirmNew) return { kind: "confirm", typed, candidates: match.candidates.slice(0, 3) };
  return { kind: "create", name: typed };
}
