"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button/Button";
import { checkOutAction, type VisitActionState } from "./actions";
import styles from "./page.module.css";

// The row's "Check out" (03): one press closes the visit NOW, as whoever is signed in. A
// press on a visit someone else already closed or removed says so; nothing is written twice.
// A check-out pressed by mistake is undone from the visit's Correct… panel (reopen), with a reason.
export function RowCheckOut({ visitId, name }: { visitId: string; name: string }) {
  const [state, action, pending] = useActionState<VisitActionState, FormData>(checkOutAction, { status: "idle" });
  return (
    <form action={action} className={styles.rowCheckOut}>
      <input type="hidden" name="visitId" value={visitId} />
      <Button type="submit" variant="row-action" disabled={pending} aria-label={`Check out ${name}`}>
        {pending ? "Saving…" : "Check out"}
      </Button>
      {state.status === "error" ? (
        <span className={styles.rowError} role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
