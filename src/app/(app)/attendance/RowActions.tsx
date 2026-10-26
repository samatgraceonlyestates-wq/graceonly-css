"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { blankName, NameField, type NameValue } from "@/components/NameField/NameField";
import { blankPhrase, PhraseField, type PhraseValue } from "@/components/PhraseField/PhraseField";
import type { CorrectionKind } from "@/lib/corrections";
import { getClockParts } from "@/lib/format";
import { matchName } from "@/lib/rosterMatch";
import {
  clockOutAction,
  correctRecordAction,
  markNoSignoutAction,
  recordDepartureAction,
  recordReturnAction,
  type BoardActionState,
} from "./actions";
import { useBoardData } from "./BoardData";
import styles from "./page.module.css";

// UNDESIGNED (the board is not in Figma). Everything the front desk does to ONE person's
// record, in the row: clock them out as they leave, record a MOVEMENT (out, and back), or
// CORRECT the record.
//
// CLOCK OUT / OUT / BACK. The time is a plain text field (8:15, 08:15 or 0815) that defaults to
// NOW on the office clock and is editable, because she may be typing it a few minutes after
// it happened. "Now" is the SERVER's render time plus the time since the page loaded, so a
// wrong browser clock cannot put a future time in the box. It is read once, when the panel
// opens: no timer of its own (the board's ticking shares useNow.ts). A shift left open from an
// EARLIER day takes its time on that day, so it has no default.
//
// OUT (a movement): where, what for, who approved it, and the time they left. Where and what
// for are SUGGESTED from what has been used before, and resolved against it by the shared
// PhraseField (another case or spacing takes the existing spelling; a close one is a question);
// the approver is a roster person by the shared NameField (suggestions, the close-name
// question answered from the keyboard). The person may approve their OWN movement (the most
// senior person has nobody above them): the panel says it will be marked self-approved.
// A person who is OUT cannot be clocked out until they are BACK: the row says so.
//
// CORRECT. Change the time in; change the time out (or give one to a shift marked never signed
// out); reopen a shift closed by mistake; unmark a never-signed-out; remove a record entered for
// the wrong person; or RESTORE one removed by mistake. EVERY correction needs a REASON: the box
// is required and there is no default text. The VERSION of the record when she opened the panel
// goes back with the form (not whatever the live refresh has since put in the page), so a record
// someone else changed in the meantime is refused with a clear message.
//
// While any panel is open the live refresh is PAUSED (data-pause-refresh): it never takes away
// what she is typing. The server decides everything and its message is shown here.

export type RowState = "in" | "out" | "gone" | "nosignout" | "removed";

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
  removed: [{ kind: "restore", label: "Restore this record" }],
};

type Mode = "clockout" | "leave" | "return" | "correct" | null;

export function RowActions({
  recordId,
  staffId,
  version,
  name,
  state,
  timeIn,
  timeOut,
  olderDay,
  openMovement,
  asOf,
}: {
  recordId: string;
  /** The person whose record this is (to say when they are approving their own movement). */
  staffId: string;
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
  /** The movement they are out on right now, if any. */
  openMovement: { id: string; left: string } | null;
  /** The server's render time (ISO). */
  asOf: string;
}) {
  const { roster, details, destinations, purposes } = useBoardData();
  const [mode, setMode] = useState<Mode>(null);
  const loadedAt = useRef(0);
  useEffect(() => {
    loadedAt.current = Date.now();
  }, [asOf]);
  const firstName = name.split(/\s+/)[0] ?? name;

  /** The office clock now, as HH:MM: the server's render time plus how long the page has been open. */
  const nowLabel = () => getClockParts(new Date(Date.parse(asOf) + (Date.now() - loadedAt.current))).time24;

  // ---- clock out
  const [outTime, setOutTime] = useState("");
  const [clockState, clockAction, clocking] = useActionState<BoardActionState, FormData>(clockOutAction, { status: "idle" });
  const [markState, markAction, marking] = useActionState<BoardActionState, FormData>(markNoSignoutAction, { status: "idle" });

  function openClockOut() {
    setOutTime(olderDay === null ? nowLabel() : "");
    setMode("clockout");
  }

  // ---- a movement: out, and back
  const [where, setWhere] = useState<PhraseValue>(blankPhrase());
  const [what, setWhat] = useState<PhraseValue>(blankPhrase());
  const [approver, setApprover] = useState<NameValue>(blankName());
  const [leftTime, setLeftTime] = useState("");
  const [backTime, setBackTime] = useState("");
  const [leaveState, leaveAction, leaving] = useActionState<BoardActionState, FormData>(recordDepartureAction, { status: "idle" });
  const [backState, backAction, returning] = useActionState<BoardActionState, FormData>(recordReturnAction, { status: "idle" });
  const whereEl = useRef<HTMLInputElement | null>(null);
  const whatEl = useRef<HTMLInputElement | null>(null);
  const approverEl = useRef<HTMLInputElement | null>(null);
  const timeEl = useRef<HTMLInputElement | null>(null);

  function openLeave() {
    setWhere(blankPhrase());
    setWhat(blankPhrase());
    setApprover(blankName());
    setLeftTime(olderDay === null ? nowLabel() : "");
    setMode("leave");
  }

  // The first box of a movement panel is focused when it opens.
  useEffect(() => {
    if (mode === "leave") whereEl.current?.focus();
  }, [mode]);

  function openReturn() {
    setBackTime(nowLabel());
    setMode("return");
  }

  // ---- correct
  const [kind, setKind] = useState<CorrectionKind | null>(null);
  const [openedVersion, setOpenedVersion] = useState(version);
  const [fixTime, setFixTime] = useState("");
  const [reason, setReason] = useState("");
  const [fixState, fixAction, fixing] = useActionState<BoardActionState, FormData>(correctRecordAction, { status: "idle" });

  function openCorrect() {
    setOpenedVersion(version); // the one she is looking at NOW; a later refresh must not replace it
    setKind(state === "removed" ? "restore" : null);
    setReason("");
    setMode("correct");
  }

  function choose(next: CorrectionKind) {
    setKind(next);
    setFixTime(next === "arrival" ? timeIn : next === "departure" ? (timeOut ?? "") : "");
  }

  // A save that succeeded closes the panel: the row now carries the "Corrected" note (who, when,
  // why), or sits in its new group, which is the confirmation. Leaving it open would also leave
  // it holding the OLD version, so a second correction from it would be refused as stale.
  const [handled, setHandled] = useState({ fixState, leaveState, backState });
  if (fixState !== handled.fixState || leaveState !== handled.leaveState || backState !== handled.backState) {
    setHandled({ fixState, leaveState, backState });
    if (fixState.status === "done" || leaveState.status === "done" || backState.status === "done") {
      setMode(null);
      setKind(null);
    }
  }

  const clockMessage = clockState.status === "error" ? clockState.message : markState.status === "error" ? markState.message : null;
  const fixMessage = fixState.status === "error" ? fixState.message : null;
  const leaveMessage = leaveState.status === "error" ? leaveState.message : null;
  const backMessage = backState.status === "error" ? backState.message : null;
  const busy = clocking || marking || fixing || leaving || returning;

  // Approving their own movement: allowed (nobody is above the most senior person), and marked.
  const approverMatch = approver.personId === null && approver.name.trim() !== "" ? matchName(approver.name, roster) : null;
  const selfApproving =
    approver.personId === staffId || (approverMatch?.kind === "exact" && approverMatch.people.length === 1 && approverMatch.people[0]!.id === staffId);

  const toggle = (target: Exclude<Mode, null>, open: () => void) => (mode === target ? setMode(null) : open());

  return (
    <>
      <div className={styles.actionCell}>
        {state === "in" ? (
          <>
            <Button variant="row-action" onClick={() => toggle("clockout", openClockOut)}>
              {mode === "clockout" ? "Close" : "Clock out"}
            </Button>
            <Button variant="row-action" onClick={() => toggle("leave", openLeave)}>
              {mode === "leave" ? "Close" : "Out…"}
            </Button>
          </>
        ) : null}
        {state === "out" && openMovement !== null ? (
          <Button variant="row-action" onClick={() => toggle("return", openReturn)}>
            {mode === "return" ? "Close" : "Back…"}
          </Button>
        ) : null}
        <Button variant="row-action" onClick={() => toggle("correct", openCorrect)}>
          {mode === "correct" ? "Close" : state === "removed" ? "Restore…" : "Correct…"}
        </Button>
      </div>

      {mode === "clockout" ? (
        <div className={styles.panel} role="group" aria-label={`Clock out ${name}`} data-pause-refresh="true">
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
              : `Now, by default. Change it if ${firstName} left earlier; it must be after ${timeIn}. (Someone who is out on a movement is clocked out once they are back.)`}
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

      {mode === "leave" ? (
        <div className={styles.panel} role="group" aria-label={`${name} goes out`} data-pause-refresh="true">
          <form action={leaveAction} className={styles.leaveForm}>
            <input type="hidden" name="recordId" value={recordId} />
            <input type="hidden" name="destination" value={where.text} />
            <input type="hidden" name="destinationConfirmNew" value={String(where.confirmNew)} />
            <input type="hidden" name="purpose" value={what.text} />
            <input type="hidden" name="purposeConfirmNew" value={String(what.confirmNew)} />
            <input type="hidden" name="approverName" value={approver.name} />
            <input type="hidden" name="approverId" value={approver.personId ?? ""} />
            <input type="hidden" name="approverConfirmNew" value={String(approver.confirmNew)} />

            <div className={styles.phraseField}>
              <span className={styles.label}>Where to</span>
              <PhraseField
                value={where}
                onChange={setWhere}
                phrases={destinations}
                onMoveOn={() => whatEl.current?.focus()}
                inputRef={(element) => {
                  whereEl.current = element;
                }}
                ariaLabel={`Where ${firstName} is going`}
                placeholder="Bank, site, court…"
                different="a different place"
                inputClassName={styles.reasonInput}
                maxLength={100}
              />
            </div>

            <div className={styles.phraseField}>
              <span className={styles.label}>What for</span>
              <PhraseField
                value={what}
                onChange={setWhat}
                phrases={purposes}
                onMoveOn={() => approverEl.current?.focus()}
                inputRef={(element) => {
                  whatEl.current = element;
                }}
                ariaLabel={`What ${firstName} is going for`}
                placeholder="Lodgement, inspection…"
                different="something different"
                inputClassName={styles.reasonInput}
                maxLength={200}
              />
            </div>

            <div className={styles.phraseField}>
              <span className={styles.label}>Approved by</span>
              <NameField
                value={approver}
                onChange={setApprover}
                roster={roster}
                details={details}
                ariaLabel="Approved by"
                placeholder="Who approved it"
                inputRef={(element) => {
                  approverEl.current = element;
                }}
                inputClassName={styles.reasonInput}
                onMoveOn={() => timeEl.current?.focus()}
                newPersonText="Not on the roster yet: will be added."
              />
            </div>

            <div className={styles.panelField}>
              <label className={styles.label} htmlFor={`left-${recordId}`}>
                Time left
              </label>
              <input
                id={`left-${recordId}`}
                ref={timeEl}
                className={styles.input}
                name="timeLeft"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1030"
                value={leftTime}
                onChange={(event) => setLeftTime(event.target.value)}
              />
            </div>
            <div className={styles.leaveSubmit}>
              <Button type="submit" size="compact" disabled={busy}>
                {leaving ? "Saving…" : `${firstName} goes out`}
              </Button>
            </div>
          </form>
          {selfApproving ? (
            <p className={styles.selfNote}>
              {name} is approving their own movement. That is allowed, and it will be marked self-approved wherever it is shown.
            </p>
          ) : null}
          <p className={styles.panelNote}>
            {olderDay !== null
              ? `${firstName} arrived on ${olderDay}: this time is on that day, after ${timeIn}.`
              : `Now, by default. Change it if ${firstName} left earlier; it must be after ${timeIn}. The approver is someone on the roster.`}
          </p>
          {leaveMessage !== null ? (
            <p className={styles.panelError} role="alert">
              {leaveMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === "return" && openMovement !== null ? (
        <div className={styles.panel} role="group" aria-label={`${name} is back`} data-pause-refresh="true">
          <form action={backAction} className={styles.panelForm}>
            <input type="hidden" name="movementId" value={openMovement.id} />
            <div className={styles.panelField}>
              <label className={styles.label} htmlFor={`back-${recordId}`}>
                Time back
              </label>
              <input
                id={`back-${recordId}`}
                className={styles.input}
                name="timeReturned"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                placeholder="1040"
                value={backTime}
                onChange={(event) => setBackTime(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setMode(null);
                }}
              />
            </div>
            <Button type="submit" size="compact" disabled={busy}>
              {returning ? "Saving…" : `${firstName} is back`}
            </Button>
          </form>
          <p className={styles.panelNote}>
            Now, by default. Change it if {firstName} came back earlier; it must be after {openMovement.left}. {firstName} can be clocked out
            only once they are back.
          </p>
          {backMessage !== null ? (
            <p className={styles.panelError} role="alert">
              {backMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === "correct" ? (
        <div className={styles.panel} role="group" aria-label={`Correct ${name}`} data-pause-refresh="true">
          <p className={styles.panelNote}>
            {state === "removed"
              ? `${name}'s record was removed and counts for nothing. Restoring it needs a reason, and is refused if it would break the one-open-shift or one-record-a-day rule.`
              : `Correcting ${name}'s record (in at ${timeIn}${timeOut ? `, out at ${timeOut}` : ""}). Every correction needs a reason, and the record will show that it was changed.`}
          </p>

          {version !== openedVersion ? (
            <p className={styles.panelError} role="alert">
              This record changed after you opened this. Close it and open it again to see the latest.
            </p>
          ) : null}

          {state !== "removed" ? (
            <div className={styles.choiceRow}>
              {CHOICES[state].map((choice) => (
                <Button key={choice.kind} variant="row-action" onClick={() => choose(choice.kind)}>
                  {choice.label}
                </Button>
              ))}
            </div>
          ) : null}

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
                  placeholder={kind === "void" ? "e.g. entered for the wrong person" : kind === "restore" ? "e.g. removed by mistake" : "e.g. the book says 08:30"}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <Button type="submit" size="compact" disabled={busy}>
                {fixing ? "Saving…" : kind === "void" ? "Remove this record" : kind === "restore" ? "Restore this record" : "Save correction"}
              </Button>
            </form>
          ) : null}

          {kind === "void" ? (
            <p className={styles.panelNote}>
              This takes {name}&apos;s record off the lists and counts. It stays on file, with your reason and your name, and can be restored.
            </p>
          ) : null}

          {fixMessage !== null ? (
            <p className={styles.panelError} role="alert">
              {fixMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
