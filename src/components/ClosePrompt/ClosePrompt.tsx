"use client";

import type { KeyboardEvent } from "react";
import { Button } from "@/components/Button/Button";
import type { Suggestion } from "@/components/Combobox/Combobox";
import styles from "./ClosePrompt.module.css";

// "Did you mean Ada Okafor (Legal)?" The close-name guard's question: the existing person
// is OFFERED, with a button that takes them, and a button that says this is a different
// person. It is answered from the keyboard in the flow of typing: the caller moves focus
// to the first button (registerRef), and then
//   Y or 1   the first person offered       2, 3   the others
//   N        a different person
//   Left and Right move between the buttons; Enter or Space presses the focused one.
// It never decides: nothing happens until she answers. Used for a PERSON (the roster) and for a
// PHRASE used before (a destination, a purpose): `different` names what "No" means.

export function ClosePrompt({
  candidates,
  ariaLabel,
  onYes,
  onNo,
  registerRef,
  different = "a different person",
}: {
  /** Up to three people close to what she typed. */
  candidates: Suggestion[];
  ariaLabel: string;
  onYes: (candidate: Suggestion) => void;
  onNo: () => void;
  registerRef?: (element: HTMLDivElement | null) => void;
  /** What "No" says: "a different person" (the default), "a different place", ... */
  different?: string;
}) {
  const shown = candidates.slice(0, 3);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const pick = key === "y" ? 0 : key >= "1" && key <= "3" ? Number(key) - 1 : -1;
    if (pick >= 0 && shown[pick] !== undefined) {
      event.preventDefault();
      onYes(shown[pick]);
    } else if (key === "n") {
      event.preventDefault();
      onNo();
    } else if (key === "arrowright" || key === "arrowleft") {
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll("button")];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at + (key === "arrowright" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }

  return (
    <div ref={registerRef} className={styles.prompt} role="group" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      <p>
        {shown.length === 1 ? "Did you mean " : "Did you mean one of these? "}
        {shown.map((candidate, at) => (
          <span key={candidate.id}>
            {at > 0 ? ", " : ""}
            <strong>{candidate.label}</strong>
            {candidate.detail ? ` (${candidate.detail})` : ""}
          </span>
        ))}
        ?
      </p>
      <div className={styles.actions}>
        {shown.map((candidate, at) => (
          <Button key={candidate.id} size="compact" onClick={() => onYes(candidate)}>
            Yes, {candidate.label}
            {candidate.detail ? ` · ${candidate.detail}` : ""}
            {shown.length > 1 ? ` (${at + 1})` : ""}
          </Button>
        ))}
        <Button variant="row-action" onClick={onNo}>
          No, {different}
        </Button>
      </div>
      <p className={styles.keys}>Keys: Y for yes{shown.length > 1 ? " (or 1, 2, 3)" : ""}, N for {different}.</p>
    </div>
  );
}
