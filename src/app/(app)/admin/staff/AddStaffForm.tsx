"use client";

import { useActionState, useCallback, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import { addStaffAction, type AddStaffState } from "./actions";
import styles from "./page.module.css";

const ROLE_CODES = ["FRONT_DESK", "LEGAL", "ADMIN", "SUPER_ADMIN"] as const;

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
  const values = new Uint8Array(16);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

const IDLE: AddStaffState = { status: "idle" };

export function AddStaffForm() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const wrappedAction = useCallback(
    async (previous: AddStaffState, formData: FormData): Promise<AddStaffState> => {
      const pw = generatePassword();
      setTempPassword(pw);
      formData.set("password", pw);
      return addStaffAction(previous, formData);
    },
    [],
  );

  const [state, submitAction, pending] = useActionState(wrappedAction, IDLE);

  const toggleRole = (code: string) => {
    setRoles((current) => (current.includes(code) ? current.filter((r) => r !== code) : [...current, code]));
  };

  const copyPassword = () => {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword).then(() => setCopied(true));
    }
  };

  if (state.status === "done" && tempPassword) {
    return (
      <Card className={styles.card}>
        <h2 className={styles.heading}>Account created</h2>
        <Notice tone="info" role="status">
          <p>Account for {state.email} has been created. They must change the password on first sign-in.</p>
        </Notice>
        <div className={styles.passwordBox}>
          <p className={styles.passwordLabel}>Temporary password (shown once):</p>
          <code className={styles.passwordValue}>{tempPassword}</code>
          <Button variant="row-action" onClick={copyPassword}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <Notice tone="limited">
          <p>Write this down or copy it now. It will not be shown again.</p>
        </Notice>
        <Button
          variant="row-action"
          onClick={() => {
            setTempPassword(null);
            setEmail("");
            setFullName("");
            setDepartment("");
            setRoles([]);
            setCopied(false);
          }}
        >
          Add another
        </Button>
      </Card>
    );
  }

  return (
    <Card className={styles.card}>
      <h2 className={styles.heading}>Add a staff member</h2>
      <form action={submitAction} className={styles.form}>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="staff-email">Email</label>
          <input
            id="staff-email"
            className={styles.input}
            name="email"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="staff-name">Full name</label>
          <input
            id="staff-name"
            className={styles.input}
            name="fullName"
            type="text"
            autoComplete="off"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="staff-department">Department</label>
          <input
            id="staff-department"
            className={styles.input}
            name="department"
            type="text"
            autoComplete="off"
            required
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </div>

        <fieldset className={styles.roleGroup}>
          <legend className={styles.label}>Roles</legend>
          {ROLE_CODES.map((code) => (
            <label key={code} className={styles.roleCheck}>
              <input
                type="checkbox"
                name="role"
                value={code}
                checked={roles.includes(code)}
                onChange={() => toggleRole(code)}
              />
              <span>{code.replace(/_/g, " ")}</span>
            </label>
          ))}
        </fieldset>

        <Button type="submit" size="compact" disabled={pending}>
          {pending ? "Creating..." : "Create account"}
        </Button>

        {state.status === "error" ? (
          <Notice tone="failure" role="alert"><p>{state.message}</p></Notice>
        ) : null}
      </form>
    </Card>
  );
}
