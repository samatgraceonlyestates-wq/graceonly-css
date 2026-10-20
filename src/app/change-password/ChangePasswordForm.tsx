"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Notice } from "@/components/Notice/Notice";
import { TextField } from "@/components/TextField/TextField";
import { changePasswordAction, type ChangePasswordState } from "./actions";
import styles from "./page.module.css";

// UNDESIGNED: this screen is not among the eight in Figma. It is built from the
// shared components only, and marked here so it is replaced when a design exists.
export function ChangePasswordForm({ next, mustChange }: { next: string; mustChange: boolean }) {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, { error: null });
  const [current, setCurrent] = useState("");
  const [fresh, setFresh] = useState("");
  const [confirm, setConfirm] = useState("");

  return (
    <form
      className={styles.form}
      action={(formData) => {
        formAction(formData);
        // Whatever happens, none of the three stays in the page.
        setCurrent("");
        setFresh("");
        setConfirm("");
      }}
    >
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <Notice tone="failure" role="alert">
          <p>{state.error}</p>
        </Notice>
      ) : null}

      <TextField
        label={mustChange ? "Temporary password" : "Current password"}
        name="current"
        type="password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        autoCapitalize="off"
        required
      />
      <TextField
        label="New password"
        name="new"
        type="password"
        value={fresh}
        onChange={setFresh}
        autoComplete="new-password"
        autoCapitalize="off"
        describedBy="password-rules"
        required
      />
      <TextField
        label="Confirm new password"
        name="confirm"
        type="password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        autoCapitalize="off"
        required
      />
      <p id="password-rules" className={styles.hint}>
        At least 12 characters. Use something you do not use anywhere else.
      </p>

      <Button type="submit" disabled={pending}>
        Change password
      </Button>
    </form>
  );
}
