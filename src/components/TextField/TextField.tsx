import { useId } from "react";
import { cx } from "@/lib/cx";
import styles from "./TextField.module.css";

// Label above, canvas-filled pill input below (CLAUDE.md "Input"). 16px text so
// iOS does not zoom on focus. Controlled.
// TODO: the login screen still has its own copy of this input's styles; move it
// onto this component when that screen is next touched.
type Props = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  // The id of a hint element to read out with the field.
  describedBy?: string;
  enterKeyHint?: "search" | "next" | "done";
  className?: string;
};

export function TextField({ label, name, value, onChange, placeholder, describedBy, enterKeyHint, className }: Props) {
  const id = useId();

  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="text"
        name={name}
        value={value}
        placeholder={placeholder}
        aria-describedby={describedBy}
        enterKeyHint={enterKeyHint}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
