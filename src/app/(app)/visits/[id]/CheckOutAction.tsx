"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button/Button";
import { Notice } from "@/components/Notice/Notice";
import { checkOutAction, type VisitActionState } from "../actions";
import styles from "./CheckOutAction.module.css";

// UNVERIFIED AGAINST FIGMA (see Panels.tsx).
// Checks the visitor out NOW, as whoever is signed in (visits.ts). A visit someone else
// already closed or removed is a clear message, never a second write. Undo is the visit's
// Correct… panel (reopen), with a reason.
//
// The form is `display: contents`, so the button joins the header's row and the
// notice takes a full row under it.
export function CheckOutAction({ visitId, name }: { visitId: string; name: string }) {
  const [state, action, pending] = useActionState<VisitActionState, FormData>(checkOutAction, { status: "idle" });

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="visitId" value={visitId} />
      <Button type="submit" disabled={pending} aria-label={`Check out ${name}`}>
        {pending ? "Checking out…" : "Check out"}
      </Button>
      {state.status === "error" ? (
        <Notice tone="failure" title="Not checked out" role="alert" className={styles.notice}>
          <p>{state.message}</p>
        </Notice>
      ) : null}
    </form>
  );
}
