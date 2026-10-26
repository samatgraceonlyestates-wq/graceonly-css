"use client";

import { useEffect, useRef, useState } from "react";
import { ClosePrompt } from "@/components/ClosePrompt/ClosePrompt";
import { Combobox } from "@/components/Combobox/Combobox";
import { matchPhrase, suggestPhrases } from "@/lib/phraseMatch";
import styles from "./PhraseField.module.css";

// A box for FREE TEXT used before: where a movement went and what it was for. The phrase twin
// of NameField, built from the same Combobox and ClosePrompt, so it behaves the same way:
//
//   * suggestions as she types, from what has been used before (most used first)
//   * the SAME phrase in another case or spacing ("first  bank" for "First Bank"): leaving the
//     box puts the EXISTING spelling in it, visibly, and says so. Three spellings of one bank
//     make every later report on movements worthless.
//   * a CLOSE phrase ("Frist Bank", "Bank" for "First Bank"): leaving the box with Enter or Tab
//     moves focus into "Did you mean First Bank?", answered from the keyboard (Y, N, 1-3)
//   * anything else is new, and is kept as typed
// The rules are in phraseMatch.ts; the server applies them again.

export interface PhraseValue {
  text: string;
  /** She has said this is something DIFFERENT from the close phrases offered. */
  confirmNew: boolean;
  /** She has been in and out of the box: only then is the question shown. */
  touched: boolean;
  /** The text was replaced by the existing spelling (shown as a hint until she edits it). */
  adopted: boolean;
}

export const blankPhrase = (text = ""): PhraseValue => ({ text, confirmNew: false, touched: false, adopted: false });

export function PhraseField({
  value,
  onChange,
  phrases,
  ariaLabel,
  placeholder,
  different,
  inputRef,
  inputClassName,
  maxLength,
  onMoveOn,
}: {
  value: PhraseValue;
  onChange: (next: PhraseValue) => void;
  /** Used before, most used first, one spelling each. */
  phrases: readonly string[];
  ariaLabel: string;
  placeholder?: string;
  /** What "No" means in the question: "a different place". */
  different: string;
  inputRef?: (element: HTMLInputElement | null) => void;
  inputClassName?: string;
  maxLength?: number;
  /** The phrase is settled (a suggestion taken, Enter pressed, or the question answered): carry on. */
  onMoveOn?: () => void;
}) {
  const promptRef = useRef<HTMLDivElement | null>(null);
  const wantPromptFocus = useRef(false);
  // The latest value sent out (see NameField: a pick then a focus move blurs before re-render).
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const emit = (next: PhraseValue) => {
    latest.current = next;
    onChange(next);
  };
  const [, bump] = useState(0);

  useEffect(() => {
    if (wantPromptFocus.current) {
      wantPromptFocus.current = false;
      promptRef.current?.querySelector("button")?.focus();
    }
  });

  const match = value.text.trim() === "" ? null : matchPhrase(value.text, phrases);
  const needsAnswer = match?.kind === "close" && !value.confirmNew;
  const showPrompt = needsAnswer && value.touched;

  /** Leaving the box: the same phrase takes the existing spelling, visibly. */
  function settle(current: PhraseValue): PhraseValue {
    const now = current.text.trim() === "" ? null : matchPhrase(current.text, phrases);
    if (now?.kind === "same" && now.phrase !== current.text) return { ...current, text: now.phrase, touched: true, adopted: true };
    return current.touched || current.text.trim() === "" ? current : { ...current, touched: true };
  }

  function answered(next: PhraseValue) {
    emit({ ...next, touched: true });
    onMoveOn?.();
  }

  return (
    <div className={styles.field}>
      <Combobox
        value={value.text}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        inputRef={inputRef}
        inputClassName={inputClassName}
        maxLength={maxLength}
        suggest={(text) => suggestPhrases(text, phrases).map((phrase) => ({ id: phrase, label: phrase }))}
        onChange={(text) => emit({ text, confirmNew: false, touched: latest.current.touched, adopted: false })}
        onPick={(item) => answered({ text: item.label, confirmNew: false, touched: true, adopted: false })}
        onBlur={() => {
          const settled = settle(latest.current);
          if (settled !== latest.current) emit(settled);
        }}
        onLeave={(key) => {
          const settled = settle(latest.current);
          if (settled !== latest.current) emit(settled);
          if (needsAnswer) {
            wantPromptFocus.current = true;
            bump((n) => n + 1);
            return true;
          }
          if (key === "Enter") onMoveOn?.();
          return false;
        }}
      />
      {showPrompt && match?.kind === "close" ? (
        <ClosePrompt
          registerRef={(element) => {
            promptRef.current = element;
          }}
          ariaLabel={`${ariaLabel}: is this one used before?`}
          different={different}
          candidates={match.candidates.map((phrase) => ({ id: phrase, label: phrase }))}
          onYes={(candidate) => answered({ text: candidate.label, confirmNew: false, touched: true, adopted: false })}
          onNo={() => answered({ ...value, confirmNew: true, touched: true })}
        />
      ) : value.adopted ? (
        <p className={styles.hint}>Same as one used before: saved with this spelling.</p>
      ) : value.confirmNew && match?.kind === "close" ? (
        <p className={styles.hint}>New, confirmed different from {match.candidates.join(", ")}.</p>
      ) : null}
    </div>
  );
}
