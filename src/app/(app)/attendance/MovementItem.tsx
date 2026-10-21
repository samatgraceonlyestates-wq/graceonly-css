"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Combobox } from "@/components/Combobox/Combobox";
import { Duration } from "@/components/Duration/Duration";
import { blankName, NameField, type NameValue } from "@/components/NameField/NameField";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { cx } from "@/lib/cx";
import type { MovementCorrectionKind } from "@/lib/movementCorrections";
import { suggestPhrases } from "@/lib/phraseMatch";
import { correctMovementAction, type BoardActionState } from "./actions";
import { useBoardData } from "./BoardData";
import styles from "./page.module.css";

// UNDESIGNED (the board is not in Figma). ONE movement of one person: where, what for, who
// approved it, when they left and came back, and how to CORRECT it, the same shape as
// correcting an attendance record (RowActions.tsx):
//   * every correction needs a REASON (required, no default text);
//   * the VERSION of the movement when she opened the panel goes back with the form, not the
//     one a live refresh has since put in the page, so a change by the other front-desk person
//     meanwhile is refused cleanly;
//   * a success closes the panel: the line then carries "Corrected at ... by ...: reason";
//   * a REMOVED movement counts for nothing and is shown struck through, with a way back.
// The approver is a roster person by the shared NameField (suggestions, the close-name
// question, answered from the keyboard); destinations and purposes are suggested from what has
// been used before.

export interface MovementView {
  id: string;
  version: string;
  /** "10:12". */
  left: string;
  /** "10:40", or null while they are still out. */
  returned: string | null;
  /** ISO, for the live "gone for". */
  leftIso: string;
  destination: string;
  purpose: string;
  approvedBy: string;
  removed: boolean;
  /** "Changed at 11:14 by Desk B: reason", for a movement that was corrected or removed. */
  note: string | null;
}

const CHOICES: { kind: MovementCorrectionKind; label: string; when: "live" | "returned" }[] = [
  { kind: "left", label: "Change time left", when: "live" },
  { kind: "returned", label: "Change time back", when: "returned" },
  { kind: "destination", label: "Change where", when: "live" },
  { kind: "purpose", label: "Change what for", when: "live" },
  { kind: "approver", label: "Change approver", when: "live" },
  { kind: "void", label: "Remove this movement", when: "live" },
];

export function MovementItem({ movement, asOf }: { movement: MovementView; asOf: string }) {
  const { roster, details, destinations, purposes } = useBoardData();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MovementCorrectionKind | null>(null);
  const [openedVersion, setOpenedVersion] = useState(movement.version);
  const [time, setTime] = useState("");
  const [where, setWhere] = useState("");
  const [what, setWhat] = useState("");
  const [approver, setApprover] = useState<NameValue>(blankName());
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState<BoardActionState, FormData>(correctMovementAction, { status: "idle" });

  // A correction that succeeded closes the panel: the line carries the note, which is the confirmation.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "done") {
      setOpen(false);
      setKind(null);
    }
  }

  function openPanel() {
    setOpenedVersion(movement.version); // the one she is looking at NOW; a later refresh must not replace it
    setKind(movement.removed ? "restore" : null);
    setReason("");
    setOpen(true);
  }

  function choose(next: MovementCorrectionKind) {
    setKind(next);
    setTime(next === "left" ? movement.left : next === "returned" ? (movement.returned ?? "") : "");
    setWhere(next === "destination" ? movement.destination : "");
    setWhat(next === "purpose" ? movement.purpose : "");
    setApprover(blankName());
  }

  const choices = CHOICES.filter((choice) => choice.when === "live" || movement.returned !== null);
  const message = state.status === "error" ? state.message : null;

  return (
    <li className={cx(styles.movement, movement.removed && styles.movementRemoved)}>
      <p className={styles.movementLine}>
        <strong>{movement.destination}</strong> · {movement.purpose} · left {movement.left}
        {movement.returned !== null ? `, back ${movement.returned}` : !movement.removed ? (
          <>
            {", gone for "}
            <Duration since={movement.leftIso} asOf={asOf} />
          </>
        ) : null}{" "}
        · approved by {movement.approvedBy}
        {movement.removed ? <StatusPill tone="steel">Removed</StatusPill> : null}
      </p>
      {movement.note !== null ? (
        <p className={styles.correctionNote}>
          <StatusPill tone="steel">{movement.removed ? "Removed" : "Corrected"}</StatusPill>
          <span>{movement.note}</span>
        </p>
      ) : null}
      <div className={styles.movementActions}>
        <Button variant="row-action" onClick={open ? () => setOpen(false) : openPanel}>
          {open ? "Close" : movement.removed ? "Restore…" : "Correct…"}
        </Button>
      </div>

      {open ? (
        <div className={styles.panel} role="group" aria-label={`Correct movement: ${movement.destination}`} data-pause-refresh="true">
          {movement.version !== openedVersion ? (
            <p className={styles.panelError} role="alert">
              This movement changed after you opened this. Close it and open it again to see the latest.
            </p>
          ) : null}

          {!movement.removed ? (
            <div className={styles.choiceRow}>
              {choices.map((choice) => (
                <Button key={choice.kind} variant="row-action" onClick={() => choose(choice.kind)}>
                  {choice.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className={styles.panelNote}>This movement was removed and counts for nothing. Restoring it needs a reason too.</p>
          )}

          {kind !== null ? (
            <form action={action} className={styles.panelForm}>
              <input type="hidden" name="movementId" value={movement.id} />
              <input type="hidden" name="version" value={openedVersion} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="time" value={kind === "left" || kind === "returned" ? time : ""} />
              <input type="hidden" name="destination" value={kind === "destination" ? where : ""} />
              <input type="hidden" name="purpose" value={kind === "purpose" ? what : ""} />
              <input type="hidden" name="approverName" value={kind === "approver" ? approver.name : ""} />
              <input type="hidden" name="approverId" value={kind === "approver" ? (approver.personId ?? "") : ""} />
              <input type="hidden" name="approverConfirmNew" value={kind === "approver" ? String(approver.confirmNew) : "false"} />

              {kind === "left" || kind === "returned" ? (
                <div className={styles.panelField}>
                  <label className={styles.label} htmlFor={`mv-time-${movement.id}`}>
                    {kind === "left" ? "New time left" : "New time back"}
                  </label>
                  <input
                    id={`mv-time-${movement.id}`}
                    className={styles.input}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    placeholder="0830"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                </div>
              ) : null}

              {kind === "destination" ? (
                <div className={styles.phraseField}>
                  <span className={styles.label}>New destination</span>
                  <Combobox
                    value={where}
                    onChange={setWhere}
                    onPick={(item) => setWhere(item.label)}
                    suggest={(text) => suggestPhrases(text, destinations).map((phrase) => ({ id: phrase, label: phrase }))}
                    ariaLabel="New destination"
                    inputClassName={styles.reasonInput}
                    maxLength={100}
                  />
                </div>
              ) : null}

              {kind === "purpose" ? (
                <div className={styles.phraseField}>
                  <span className={styles.label}>New purpose</span>
                  <Combobox
                    value={what}
                    onChange={setWhat}
                    onPick={(item) => setWhat(item.label)}
                    suggest={(text) => suggestPhrases(text, purposes).map((phrase) => ({ id: phrase, label: phrase }))}
                    ariaLabel="New purpose"
                    inputClassName={styles.reasonInput}
                    maxLength={200}
                  />
                </div>
              ) : null}

              {kind === "approver" ? (
                <div className={styles.phraseField}>
                  <span className={styles.label}>New approver</span>
                  <NameField
                    value={approver}
                    onChange={setApprover}
                    roster={roster}
                    details={details}
                    ariaLabel="New approver"
                    placeholder="Who approved it"
                    inputClassName={styles.reasonInput}
                    newPersonText="Not on the roster yet: will be added."
                  />
                </div>
              ) : null}

              <div className={styles.reasonField}>
                <label className={styles.label} htmlFor={`mv-reason-${movement.id}`}>
                  Why? (required)
                </label>
                <input
                  id={`mv-reason-${movement.id}`}
                  className={styles.reasonInput}
                  name="reason"
                  type="text"
                  autoComplete="off"
                  maxLength={500}
                  required
                  autoFocus={kind === "void" || kind === "restore"}
                  placeholder={kind === "void" ? "e.g. entered twice" : "e.g. the book says so"}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <Button type="submit" size="compact" disabled={pending}>
                {pending ? "Saving…" : kind === "void" ? "Remove this movement" : kind === "restore" ? "Restore this movement" : "Save correction"}
              </Button>
            </form>
          ) : null}

          {message !== null ? (
            <p className={styles.panelError} role="alert">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
