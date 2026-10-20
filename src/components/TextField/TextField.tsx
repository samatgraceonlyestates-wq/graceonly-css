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
  // Defaults keep it a plain text field: type "text", autocomplete off, words
  // capitalised, not required. A password field sets all of these.
  type?: "text" | "password";
  autoComplete?: string;
  autoCapitalize?: "off" | "words";
  required?: boolean;
};

export function TextField({
  label,
  name,
  value,
  onChange,
  placeholder,
  describedBy,
  enterKeyHint,
  className,
  type = "text",
  autoComplete = "off",
  autoCapitalize = "words",
  required = false,
}: Props) {
  const id = useId();

  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type={type}
        name={name}
        value={value}
        placeholder={placeholder}
        aria-describedby={describedBy}
        enterKeyHint={enterKeyHint}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        required={required}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
