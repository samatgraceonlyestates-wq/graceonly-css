"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import { closeDayAction, type VisitActionState } from "./actions";
import styles from "./page.module.css";

// UNDESIGNED. The end of the day for the visitor log: every visit still open can be closed,
// so a forgotten check-out does not sit "in the building" for ever. ALWAYS an explicit act:
// a button, then a confirmation that names the visitors. The app never closes a visit by
// itself. A visit closed here is AUTO_CLOSED with the name of whoever closed it, and the time
// they LEFT stays unknown: no screen shows its length. It can be given a time, or reopened,
// from the visit's Correct… panel.
export function CloseDay({ visits }: { visits: { id: string; name: string }[] }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(closeDayAction, { status: "idle" });

  if (visits.length === 0 && state.status !== "done") return null;

  return (
    <Card as="section" padding="md" aria-labelledby="close-day-heading" className={styles.section}>
      <h2 id="close-day-heading" className={styles.sectionTitle}>
        End of day
      </h2>

      {state.status === "done" ? (
        <Notice tone="info" role="status">
          <p>{state.message}</p>
        </Notice>
      ) : null}
      {state.status === "error" ? (
        <Notice tone="failure" role="alert">
          <p>{state.message}</p>
        </Notice>
      ) : null}

      {visits.length > 0 ? (
        <>
          <p className={styles.sectionNote}>
            {visits.length} {visits.length === 1 ? "visit is" : "visits are"} still open. If they left without being checked
            out, close {visits.length === 1 ? "it" : "them"} so the list shows who is really here. When they left will be
            recorded as unknown, never guessed.
          </p>
          {confirming ? (
            <form action={formAction} className={styles.confirm}>
              {visits.map((visit) => (
                <input key={visit.id} type="hidden" name="visitId" value={visit.id} />
              ))}
              <p className={styles.confirmText}>
                Close {visits.length === 1 ? "this visit" : `these ${visits.length} visits`} with no time out?{" "}
                <strong>{visits.map((visit) => visit.name).join(", ")}</strong>. Each will say it was closed at the end of
                the day, by you. A visit can be given its real time, or reopened, from its Correct… panel.
              </p>
              <div className={styles.confirmActions}>
                <Button type="submit" size="compact" disabled={pending}>
                  {pending ? "Saving…" : `Yes, close ${visits.length}`}
                </Button>
                <Button variant="row-action" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button variant="row-action" onClick={() => setConfirming(true)}>
                Close {visits.length} open {visits.length === 1 ? "visit" : "visits"}…
              </Button>
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}
