"use client";

import { useEffect, useRef, useState } from "react";
import { ClosePrompt } from "@/components/ClosePrompt/ClosePrompt";
import { Combobox, type Suggestion } from "@/components/Combobox/Combobox";
import { cx } from "@/lib/cx";
import { matchName, suggest, type RosterName } from "@/lib/rosterMatch";
import styles from "./NameField.module.css";

// A box for the name of a PERSON ON THE ROSTER: the arrivals sheet (who arrived) and the
// movement book (who approved). One component, so the matching, the suggestions and the
// close-name guard are the same everywhere (the rules are in rosterMatch.ts and
// nameResolution.ts; the server applies them again).
//
//   * suggestions as she types, matching any word of the name; two people of one name are
//     told apart by their detail (department, when added)
//   * a CLOSE name (a typo or a partial of someone on the roster) is not accepted silently:
//     leaving the box with Enter or Tab moves focus into "Did you mean Ada Okafor?", which
//     is answered from the keyboard (Y, N, 1-3), and the flow carries on at `onMoveOn`
//   * a name nobody is near is a NEW roster person, and says so
// The capitalisation of what she types is never changed.

export interface NameValue {
  name: string;
  /** Set when she picked a suggestion; cleared as soon as the name is edited. */
  personId: string | null;
  /** She has said this name is a DIFFERENT person from the close ones. */
  confirmNew: boolean;
  /** She has been in and out of the box: only then is the hint or the question shown. */
  touched: boolean;
}

export const blankName = (): NameValue => ({ name: "", personId: null, confirmNew: false, touched: false });

/** Is this name close to someone on the roster, and not yet answered? */
export function nameNeedsAnswer(value: NameValue, roster: readonly RosterName[]): boolean {
  if (value.name.trim() === "" || value.personId !== null || value.confirmNew) return false;
  return matchName(value.name, roster).kind === "close";
}

const toSuggestion = (person: RosterName, details: Map<string, string>): Suggestion => ({
  id: person.id,
  label: person.name,
  detail: details.get(person.id) || undefined,
});

export function NameField({
  value,
  onChange,
  roster,
  details,
  ariaLabel,
  placeholder = "Name",
  inputRef,
  inputClassName,
  invalid,
  onMoveOn,
  newPersonText = "New person: will be added to the roster.",
  className,
}: {
  value: NameValue;
  onChange: (next: NameValue) => void;
  roster: readonly RosterName[];
  /** personDetails(roster): what tells two people of one name apart. */
  details: Map<string, string>;
  ariaLabel: string;
  placeholder?: string;
  inputRef?: (element: HTMLInputElement | null) => void;
  inputClassName?: string;
  invalid?: boolean;
  /** The name is settled (a suggestion taken, Enter pressed, or the question answered): carry on to the next field. */
  onMoveOn?: () => void;
  newPersonText?: string;
  className?: string;
}) {
  const promptRef = useRef<HTMLDivElement | null>(null);
  const wantPromptFocus = useRef(false);
  // The LATEST value this field has sent out. Taking a suggestion sends the picked person and
  // then moves focus on, which blurs this box before React has re-rendered it: the blur must
  // build on what was just sent, not on the value this render closed over, or it would put the
  // half-typed text back and undo the pick.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const emit = (next: NameValue) => {
    latest.current = next;
    onChange(next);
  };
  const [, bump] = useState(0);

  // Focus goes into the question once it has been drawn.
  useEffect(() => {
    if (wantPromptFocus.current) {
      wantPromptFocus.current = false;
      promptRef.current?.querySelector("button")?.focus();
    }
  });

  const needsAnswer = nameNeedsAnswer(value, roster);
  const showPrompt = needsAnswer && value.touched;
  const match = value.touched && value.name.trim() !== "" ? matchName(value.name, roster) : null;

  function ask() {
    if (!value.touched) emit({ ...value, touched: true });
    wantPromptFocus.current = true;
    bump((n) => n + 1);
  }

  function answered(next: NameValue) {
    emit({ ...next, touched: true });
    onMoveOn?.();
  }

  const hint =
    match === null || match.kind === "empty" || value.personId !== null
      ? null
      : match.kind === "exact"
        ? match.people.length > 1
          ? { warn: true, text: "Two people have this name. Pick the right one from the list." }
          : null // a known person needs no line: thirty of them would only bury the exceptions
        : match.kind === "none"
          ? { warn: false, text: newPersonText }
          : value.confirmNew
            ? { warn: false, text: `New person, confirmed different from ${match.candidates.map((c) => c.name).join(", ")}.` }
            : null;

  return (
    <div className={cx(styles.field, className)}>
      <Combobox
        value={value.name}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        inputRef={inputRef}
        inputClassName={inputClassName}
        invalid={invalid}
        suppress={value.personId !== null}
        suggest={(text) => suggest(text, roster).map((person) => toSuggestion(person, details))}
        onChange={(text) => emit({ name: text, personId: null, confirmNew: false, touched: latest.current.touched })}
        onPick={(item) => answered({ name: item.label, personId: item.id, confirmNew: false, touched: true })}
        onBlur={() => {
          const current = latest.current;
          if (current.name.trim() !== "" && !current.touched) emit({ ...current, touched: true });
        }}
        onLeave={(key) => {
          if (needsAnswer) {
            ask();
            return true;
          }
          if (key === "Enter") onMoveOn?.();
          return false;
        }}
      />

      {showPrompt ? (
        <ClosePrompt
          registerRef={(element) => {
            promptRef.current = element;
          }}
          ariaLabel={`${ariaLabel}: is this someone already on the roster?`}
          candidates={(match?.kind === "close" ? match.candidates : []).slice(0, 3).map((person) => toSuggestion(person, details))}
          onYes={(candidate) => answered({ name: candidate.label, personId: candidate.id, confirmNew: false, touched: true })}
          onNo={() => answered({ ...value, confirmNew: true, touched: true })}
        />
      ) : hint !== null ? (
        <p className={cx(styles.hint, hint.warn && styles.hintWarn)}>{hint.text}</p>
      ) : null}
    </div>
  );
}
