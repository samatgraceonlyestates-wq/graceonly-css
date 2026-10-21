"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import { markNoSignoutAction, type BoardActionState } from "./actions";
import styles from "./page.module.css";

// UNDESIGNED. The end of the day: anyone still showing IN can be marked as having not
// signed out, so open shifts do not rot (an open shift blocks that person's next
// arrival). It is ALWAYS an explicit act: a button, then a confirmation that names the
// people. The app never does this by itself, and it never invents a time: a marked
// shift has NO clock-out and its hours are UNKNOWN.
export function EndOfDay({ people }: { people: { id: string; name: string }[] }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<BoardActionState, FormData>(markNoSignoutAction, { status: "idle" });

  if (people.length === 0 && state.status !== "done") return null;

  return (
    <Card as="section" padding="md" aria-labelledby="end-of-day-heading" className={styles.endOfDay}>
      <h2 id="end-of-day-heading" className={styles.sectionTitle}>
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

      {people.length > 0 ? (
        <>
          <p className={styles.sectionNote}>
            {people.length} {people.length === 1 ? "person is" : "people are"} still showing as in. If they went home without
            signing the book out, mark them as not signed out so their records do not stay open. Their hours for those shifts
            will be unknown.
          </p>

          {confirming ? (
            <form action={formAction} className={styles.confirm} data-pause-refresh="true">
              {people.map((person) => (
                <input key={person.id} type="hidden" name="recordId" value={person.id} />
              ))}
              <p className={styles.confirmText}>
                Mark {people.length === 1 ? "this person" : `these ${people.length} people`} as not signed out?{" "}
                <strong>{people.map((person) => person.name).join(", ")}</strong>. Their hours will be unknown. It can be undone
                later from the person&apos;s Correct… panel.
              </p>
              <div className={styles.confirmActions}>
                <Button type="submit" size="compact" disabled={pending}>
                  {pending ? "Saving…" : `Yes, mark ${people.length}`}
                </Button>
                <Button variant="row-action" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button variant="row-action" onClick={() => setConfirming(true)}>
                Mark {people.length} as not signed out…
              </Button>
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}
