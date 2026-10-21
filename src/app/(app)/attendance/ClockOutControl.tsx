"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { getClockParts } from "@/lib/format";
import { clockOutAction, markNoSignoutAction, type BoardActionState } from "./actions";
import styles from "./page.module.css";

// UNDESIGNED (the today board is not in Figma). Clocks ONE person out, as they leave.
//
// The time is a plain text field (8:15, 08:15 or 0815, like the arrivals sheet). It
// defaults to NOW on the office clock but is editable, because she may be typing it a
// few minutes after they went. "Now" is taken from the SERVER's render time plus the
// time since the page loaded, so a wrong browser clock cannot put a future time in
// the box. This reads the clock once, when the panel is opened: it adds no timer of
// its own (the board's ticking shares useNow.ts, via <Duration />).
//
// The server decides everything (before their time in, in the future, out on a
// movement...) and its message is shown here. A shift left open from an EARLIER day
// takes its time out on THAT day, so it has no default.
//
// "They never signed out" is a separate, explicit button: the shift is closed with NO
// time and its hours become unknown (never zero, never guessed).
export function ClockOutControl({
  recordId,
  name,
  timeIn,
  olderDay,
  asOf,
}: {
  recordId: string;
  name: string;
  /** Their time in, "07:16", for the hint. */
  timeIn: string;
  /** "Monday, 19 October 2026" when the shift is still open from an earlier day, else null. */
  olderDay: string | null;
  /** The server's render time (ISO). */
  asOf: string;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState("");
  const loadedAt = useRef(0);
  const [clockState, clockAction, clocking] = useActionState<BoardActionState, FormData>(clockOutAction, { status: "idle" });
  const [markState, markAction, marking] = useActionState<BoardActionState, FormData>(markNoSignoutAction, { status: "idle" });

  useEffect(() => {
    loadedAt.current = Date.now();
  }, [asOf]);

  const message = clockState.status === "error" ? clockState.message : markState.status === "error" ? markState.message : null;
  const firstName = name.split(/\s+/)[0] ?? name;

  function openPanel() {
    // Server time now = the render time + how long the page has been open.
    const serverNow = Date.parse(asOf) + (Date.now() - loadedAt.current);
    setTime(olderDay === null ? getClockParts(new Date(serverNow)).time24 : "");
    setOpen(true);
  }

  return (
    <>
      <div className={styles.actionCell}>
        <Button variant="row-action" onClick={open ? () => setOpen(false) : openPanel}>
          {open ? "Close" : "Clock out"}
        </Button>
      </div>

      {open ? (
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
                value={time}
                onChange={(event) => setTime(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                }}
              />
            </div>
            <Button type="submit" size="compact" disabled={clocking || marking}>
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
            <Button variant="row-action" type="submit" disabled={clocking || marking}>
              {marking ? "Saving…" : `${firstName} never signed out`}
            </Button>
            <span className={styles.panelNote}>Closes the record with no time. Their hours will be unknown.</span>
          </form>

          {message !== null ? (
            <p className={styles.panelError} role="alert">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
