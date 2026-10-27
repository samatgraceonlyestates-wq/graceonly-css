"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Notice } from "@/components/Notice/Notice";
import {
  escalateCaseAction,
  resolveCaseAction,
  sendMessageAction,
  type CaseActionState,
} from "./actions";
import styles from "./CaseActions.module.css";

type ActionKind = "message" | "resolve" | "escalate" | null;

const IDLE: CaseActionState = { status: "idle" };

function ActionForm({
  caseId,
  version,
  action,
  label,
  placeholder,
  submitLabel,
  onClose,
}: {
  caseId: string;
  version: number;
  action: (previous: CaseActionState, formData: FormData) => Promise<CaseActionState>;
  label: string;
  placeholder: string;
  submitLabel: string;
  onClose: () => void;
}) {
  const [state, submitAction, pending] = useActionState(action, IDLE);

  if (state.status === "done") {
    return (
      <Notice tone="info" role="status">
        <p>{state.message}</p>
      </Notice>
    );
  }

  return (
    <form action={submitAction} className={styles.form}>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="version" value={version} />
      <p className={styles.formLabel}>{label}</p>

      <textarea
        name="body"
        placeholder={placeholder}
        required
        rows={3}
        className={styles.textarea}
      />

      {state.status === "error" ? (
        <Notice tone="failure" role="alert">
          <p>{state.message}</p>
        </Notice>
      ) : null}

      <div className={styles.formButtons}>
        <Button type="submit" size="compact" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <button type="button" className={styles.cancel} onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CaseActions({
  caseId,
  version,
  escalated,
}: {
  caseId: string;
  version: number;
  escalated: boolean;
}) {
  const [open, setOpen] = useState<ActionKind>(null);

  if (open) {
    const forms: Record<Exclude<ActionKind, null>, { action: typeof sendMessageAction; label: string; placeholder: string; submitLabel: string }> = {
      message: { action: sendMessageAction, label: "Add a message to this case", placeholder: "Type a message…", submitLabel: "Send message" },
      resolve: { action: resolveCaseAction, label: "Resolve this case", placeholder: "Resolution note…", submitLabel: "Resolve case" },
      escalate: { action: escalateCaseAction, label: "Escalate this case", placeholder: "Reason for escalation…", submitLabel: "Escalate" },
    };
    const f = forms[open];
    return (
      <div className={styles.panel}>
        <ActionForm
          caseId={caseId}
          version={version}
          action={f.action}
          label={f.label}
          placeholder={f.placeholder}
          submitLabel={f.submitLabel}
          onClose={() => setOpen(null)}
        />
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      <Button size="compact" onClick={() => setOpen("message")}>
        Message
      </Button>
      <Button size="compact" onClick={() => setOpen("resolve")}>
        Resolve
      </Button>
      {!escalated ? (
        <Button size="compact" onClick={() => setOpen("escalate")}>
          Escalate
        </Button>
      ) : null}
    </div>
  );
}
