"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import type { CorrectionKind } from "@/lib/corrections";
import { getClockParts } from "@/lib/format";
import { clockOutAction, correctRecordAction, markNoSignoutAction, type BoardActionState } from "./actions";
import styles from "./page.module.css";

// UNDESIGNED (the board is not in Figma). Everything the front desk does to ONE person's
// record, in the row: clock them out as they leave, or CORRECT the record.
//
// CLOCK OUT. The time is a plain text field (8:15, 08:15 or 0815) that defaults to NOW on
// the office clock and is editable, because she may be typing it a few minutes after they
// went. "Now" is the SERVER's render time plus the time since the page loaded, so a wrong
// browser clock cannot put a future time in the box. It is read once, when the panel
// opens: no timer of its own (the board's ticking shares useNow.ts). A shift left open
// from an EARLIER day takes its time on that day, so it has no default.
//
// CORRECT. Change the time in; change the time out (or give one to a shift marked never
// signed out); reopen a shift closed by mistake; unmark a never-signed-out; or remove a
// record entered for the wrong person. EVERY correction needs a REASON: the box is
// required and there is no default text. Front desk and admin may both correct; the reason
// is the control, not a permission. The VERSION of the record when she opened the panel
// goes back with the form (not whatever the live refresh has since put in the page), so a
// record someone else changed in the meantime is refused with a clear message.
//
// The server decides everything and its message is shown here.

export type RowState = "in" | "out" | "gone" | "nosignout";

const CHOICES: Record<RowState, { kind: CorrectionKind; label: string }[]> = {
  in: [
    { kind: "arrival", label: "Change time in" },
    { kind: "void", label: "Remove: wrong person" },
  ],
  out: [{ kind: "arrival", label: "Change time in" }],
  gone: [
    { kind: "arrival", label: "Change time in" },
    { kind: "departure", label: "Change time out" },
    { kind: "reopen", label: "Reopen: undo clock-out" },
    { kind: "void", label: "Remove: wrong person" },
  ],
  nosignout: [
    { kind: "arrival", label: "Change time in" },
    { kind: "departure", label: "Add the time out" },
    { kind: "unmark", label: "Unmark: back to still in" },
    { kind: "void", label: "Remove: wrong person" },
  ],
};

export function RowActions({
  recordId,
  version,
  name,
  state,
  timeIn,
  timeOut,
  olderDay,
  asOf,
}: {
  recordId: string;
  /** The record's version as of this render. */
  version: string;
  name: string;
  state: RowState;
  /** "07:16". */
  timeIn: string;
  /** "10:30", or null. */
  timeOut: string | null;
  /** "Monday, 19 October 2026" when the shift is still open from an earlier day, else null. */
  olderDay: string | null;
  /** The server's render time (ISO). */
  asOf: string;
}) {
  const [mode, setMode] = useState<"clockout" | "correct" | null>(null);
  const loadedAt = useRef(0);
  useEffect(() => {
    loadedAt.current = Date.now();
  }, [asOf]);
  const firstName = name.split(/\s+/)[0] ?? name;

  // ---- clock out
  const [outTime, setOutTime] = useState("");
  const [clockState, clockAction, clocking] = useActionState<BoardActionState, FormData>(clockOutAction, { status: "idle" });
  const [markState, markAction, marking] = useActionState<BoardActionState, FormData>(markNoSignoutAction, { status: "idle" });

  function openClockOut() {
    // Server time now = the render time + how long the page has been open.
    const serverNow = Date.parse(asOf) + (Date.now() - loadedAt.current);
    setOutTime(olderDay === null ? getClockParts(new Date(serverNow)).time24 : "");
    setMode("clockout");
  }

  // ---- correct
  const [kind, setKind] = useState<CorrectionKind | null>(null);
  const [openedVersion, setOpenedVersion] = useState(version);
  const [fixTime, setFixTime] = useState("");
  const [reason, setReason] = useState("");
  const [fixState, fixAction, fixing] = useActionState<BoardActionState, FormData>(correctRecordAction, { status: "idle" });

  function openCorrect() {
    setOpenedVersion(version); // the one she is looking at NOW; a later refresh must not replace it
    setKind(null);
    setReason("");
    setMode("correct");
  }

  function choose(next: CorrectionKind) {
    setKind(next);
    setFixTime(next === "arrival" ? timeIn : next === "departure" ? (timeOut ?? "") : "");
  }

  // A correction that succeeded closes the panel: the row now carries the "Corrected" note
  // (who, when, why), which is the confirmation. Leaving it open would also leave it holding
  // the OLD version, so a second correction from it would be refused as stale, and the
  // "changed since you opened this" warning would fire on her own change.
  const [handledFix, setHandledFix] = useState(fixState);
  if (fixState !== handledFix) {
    setHandledFix(fixState);
    if (fixState.status === "done") {
      setMode(null);
      setKind(null);
    }
  }

  const clockMessage = clockState.status === "error" ? clockState.message : markState.status === "error" ? markState.message : null;
  const fixMessage = fixState.status === "error" ? fixState.message : fixState.status === "done" ? fixState.message : null;
  const busy = clocking || marking || fixing;

  return (
    <>
      <div className={styles.actionCell}>
        {state === "in" ? (
          <Button variant="row-action" onClick={mode === "clockout" ? () => setMode(null) : openClockOut}>
            {mode === "clockout" ? "Close" : "Clock out"}
          </Button>
        ) : null}
        <Button variant="row-action" onClick={mode === "correct" ? () => setMode(null) : openCorrect}>
          {mode === "correct" ? "Close" : "Correct…"}
        </Button>
      </div>

      {mode === "clockout" ? (
        <div className={styles.panel} role="group" aria-label={`Clock out ${name}`}>
          <form action={clockAction} className={styles.panelForm}>
            <input type="hidden" name="recordId" value={recordId} />
            <div className={styles.panelField}>
              <label className={styles.label} htmlFor={`out-${recordId}`}>
                Time out
              </label>
              <input
                id={`out-${recordId}`}
                className={styles.input}
                name="timeOut"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                placeholder="1700"
                value={outTime}
                onChange={(event) => setOutTime(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setMode(null);
                }}
              />
            </div>
            <Button type="submit" size="compact" disabled={busy}>
              {clocking ? "Saving…" : `Clock out ${firstName}`}
            </Button>
          </form>
          <p className={styles.panelNote}>
            {olderDay !== null
              ? `${firstName} arrived on ${olderDay} and was never clocked out. This time is on that day, after ${timeIn}.`
              : `Now, by default. Change it if ${firstName} left earlier; it must be after ${timeIn}.`}
          </p>

          <form action={markAction} className={styles.panelForm}>
            <input type="hidden" name="recordId" value={recordId} />
            <Button variant="row-action" type="submit" disabled={busy}>
              {marking ? "Saving…" : `${firstName} never signed out`}
            </Button>
            <span className={styles.panelNote}>Closes the record with no time. Their hours will be unknown.</span>
          </form>

          {clockMessage !== null ? (
            <p className={styles.panelError} role="alert">
              {clockMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === "correct" ? (
        <div className={styles.panel} role="group" aria-label={`Correct ${name}`}>
          <p className={styles.panelNote}>
            Correcting {name}&apos;s record (in at {timeIn}
            {timeOut ? `, out at ${timeOut}` : ""}). Every correction needs a reason, and the record will show that it was changed.
          </p>

          {version !== openedVersion ? (
            <p className={styles.panelError} role="alert">
              This record changed after you opened this. Close it and open it again to see the latest.
            </p>
          ) : null}

          <div className={styles.choiceRow}>
            {CHOICES[state].map((choice) => (
              <Button key={choice.kind} variant="row-action" onClick={() => choose(choice.kind)}>
                {choice.label}
              </Button>
            ))}
          </div>

          {kind !== null ? (
            <form action={fixAction} className={styles.panelForm}>
              <input type="hidden" name="recordId" value={recordId} />
              <input type="hidden" name="version" value={openedVersion} />
              <input type="hidden" name="kind" value={kind} />
              {kind === "arrival" || kind === "departure" ? (
                <div className={styles.panelField}>
                  <label className={styles.label} htmlFor={`fix-time-${recordId}`}>
                    {kind === "arrival" ? "New time in" : "New time out"}
                  </label>
                  <input
                    id={`fix-time-${recordId}`}
                    className={styles.input}
                    name="time"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    placeholder="0830"
                    value={fixTime}
                    onChange={(event) => setFixTime(event.target.value)}
                  />
                </div>
              ) : (
                <input type="hidden" name="time" value="" />
              )}
              <div className={styles.reasonField}>
                <label className={styles.label} htmlFor={`fix-reason-${recordId}`}>
                  Why? (required)
                </label>
                <input
                  id={`fix-reason-${recordId}`}
                  className={styles.reasonInput}
                  name="reason"
                  type="text"
                  autoComplete="off"
                  maxLength={500}
                  required
                  autoFocus={kind !== "arrival" && kind !== "departure"}
                  placeholder={kind === "void" ? "e.g. entered for the wrong person" : "e.g. the book says 08:30"}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <Button type="submit" size="compact" disabled={busy}>
                {fixing ? "Saving…" : kind === "void" ? "Remove this record" : "Save correction"}
              </Button>
            </form>
          ) : null}

          {kind === "void" ? (
            <p className={styles.panelNote}>
              This takes {name}&apos;s record off the lists and counts. It stays on file, with your reason and your name.
            </p>
          ) : null}

          {fixMessage !== null ? (
            <p className={fixState.status === "error" ? styles.panelError : styles.panelNote} role={fixState.status === "error" ? "alert" : "status"}>
              {fixMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
