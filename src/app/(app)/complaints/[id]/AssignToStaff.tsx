"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/Button/Button";
import { Notice } from "@/components/Notice/Notice";
import { ASSIGNMENT_PRIORITIES } from "@/lib/assignments";
import {
  assignToStaffAction,
  loadStaffAction,
  type AssignState,
  type StaffListState,
  type StaffOption,
} from "./actions";
import styles from "./AssignToStaff.module.css";

const IDLE: AssignState = { status: "idle" };

function staffLabel(member: StaffOption): string {
  const tail = [member.department, member.role].filter(Boolean).join(" · ");
  return tail ? `${member.name} — ${tail}` : member.name;
}

export function AssignToStaff({ caseId, alreadyAssigned }: { caseId: string; alreadyAssigned: boolean }) {
  const [open, setOpen] = useState(false);
  const [staffState, setStaffState] = useState<StaffListState | null>(null);
  const [loadingStaff, startStaffLoad] = useTransition();
  const [email, setEmail] = useState("");
  const [priority, setPriority] = useState("");
  const [confirmRepeat, setConfirmRepeat] = useState(false);
  const [state, submit, submitting] = useActionState(assignToStaffAction, IDLE);

  // Load the roster the first time the panel opens.
  useEffect(() => {
    if (!open || staffState !== null || loadingStaff) return;
    startStaffLoad(async () => {
      setStaffState(await loadStaffAction());
    });
  }, [open, staffState, loadingStaff]);

  if (!open) {
    return (
      <Button size="compact" onClick={() => setOpen(true)} aria-expanded={false} aria-controls="assign-panel">
        Assign to staff
      </Button>
    );
  }

  if (state.status === "done") {
    return (
      <Notice tone="info" role="status">
        <p>{state.message}</p>
        {state.taskLink ? (
          <p>
            <a href={state.taskLink} className={styles.taskLink} target="_blank" rel="noreferrer">
              View task in the staff portal →
            </a>
          </p>
        ) : null}
      </Notice>
    );
  }

  const selected = staffState?.status === "ok" ? staffState.staff.find((m) => m.email === email) ?? null : null;
  const canSubmit = selected !== null && (!alreadyAssigned || confirmRepeat);

  return (
    <div className={styles.panel} id="assign-panel">
      <p className={styles.formLabel}>Assign this dispute to a staff member</p>

      {loadingStaff && staffState === null ? <p className={styles.loading}>Loading staff…</p> : null}

      {staffState?.status === "error" ? (
        <Notice tone="failure" role="alert">
          <p>Could not load the staff list: {staffState.message}</p>
        </Notice>
      ) : null}

      {staffState?.status === "ok" && staffState.staff.length === 0 ? (
        <p className={styles.loading}>The staff portal returned no staff to assign to.</p>
      ) : null}

      {staffState?.status === "ok" && staffState.staff.length > 0 ? (
        <form action={submit} className={styles.form}>
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="assigneeEmail" value={selected?.email ?? ""} />
          <input type="hidden" name="assigneeName" value={selected?.name ?? ""} />

          <div className={styles.field}>
            <label htmlFor="assign-staff" className={styles.label}>Staff member</label>
            <select
              id="assign-staff"
              className={styles.select}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            >
              <option value="">Choose a staff member…</option>
              {staffState.staff.map((member) => (
                <option key={member.email} value={member.email}>
                  {staffLabel(member)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="assign-priority" className={styles.label}>Priority (optional)</label>
            <select
              id="assign-priority"
              name="priority"
              className={styles.select}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">No priority</option>
              {ASSIGNMENT_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {alreadyAssigned ? (
            <label className={styles.confirm}>
              <input
                type="checkbox"
                name="confirmRepeat"
                value="yes"
                checked={confirmRepeat}
                onChange={(e) => setConfirmRepeat(e.target.checked)}
              />
              <span>This dispute is already assigned. Assign it again anyway.</span>
            </label>
          ) : null}

          {state.status === "error" ? (
            <Notice tone="failure" role="alert">
              <p>{state.message}</p>
            </Notice>
          ) : null}

          <div className={styles.formButtons}>
            <Button type="submit" size="compact" disabled={submitting || !canSubmit}>
              {submitting ? "Assigning…" : "Assign"}
            </Button>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
