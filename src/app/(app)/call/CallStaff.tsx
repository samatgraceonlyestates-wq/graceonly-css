"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Notice } from "@/components/Notice/Notice";
import { ActiveCall } from "./ActiveCall";
import { callStaffAction, type CallState, type StaffListState, type StaffOption } from "./actions";
import styles from "./CallStaff.module.css";

const IDLE: CallState = { status: "idle" };

function label(member: StaffOption): string {
  const tail = [member.department, member.role].filter(Boolean).join(" · ");
  return tail ? `${member.name} — ${tail}` : member.name;
}

export function CallStaff({ staffState }: { staffState: StaffListState }) {
  const [calleeStaffId, setCalleeStaffId] = useState("");
  const [state, submit, submitting] = useActionState(callStaffAction, IDLE);

  // A call is live: hand off to the LiveKit room UI.
  if (state.status === "calling") {
    return <ActiveCall session={state.session} onClose={() => window.location.reload()} />;
  }

  if (staffState.status === "error") {
    return (
      <Notice tone="failure" role="alert">
        <p>Could not load the staff list from the team app: {staffState.message}</p>
      </Notice>
    );
  }

  if (staffState.staff.length === 0) {
    return <p className={styles.empty}>The team app returned no staff to call.</p>;
  }

  return (
    <form action={submit} className={styles.form}>
      <input type="hidden" name="calleeStaffId" value={calleeStaffId} />

      <div className={styles.field}>
        <label htmlFor="call-staff" className={styles.label}>Staff member</label>
        <select
          id="call-staff"
          className={styles.select}
          value={calleeStaffId}
          onChange={(e) => setCalleeStaffId(e.target.value)}
          required
        >
          <option value="">Choose a staff member…</option>
          {staffState.staff.map((member) => (
            <option key={member.id} value={member.id}>
              {label(member)}
            </option>
          ))}
        </select>
      </div>

      {state.status === "error" ? (
        <Notice tone="failure" role="alert">
          <p>{state.message}</p>
        </Notice>
      ) : null}

      <Button type="submit" disabled={submitting || calleeStaffId === ""}>
        {submitting ? "Calling…" : "Call"}
      </Button>
    </form>
  );
}
