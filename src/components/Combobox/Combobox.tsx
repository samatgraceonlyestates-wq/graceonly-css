"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { cx } from "@/lib/cx";
import styles from "./Combobox.module.css";

// A text box with a list of suggestions under it (the ARIA combobox pattern), used for
// names on the arrivals sheet, for the approver of a movement, and for destinations and
// purposes. It only SUGGESTS: the text is whatever she typed, never rewritten.
//
//   Arrow keys   move through the list
//   Enter        takes the highlighted suggestion (a single suggestion is already
//                highlighted, so "divi" then Enter is enough)
//   Enter / Tab  with nothing to take: `onLeave` decides (move on, or ask a question)
//   mouse        a press on a suggestion takes it (a press, not a click, so the box keeps focus)
//
// The suggestions are computed HERE, from the text, by the `suggest` the caller passes, and
// only while the box has focus. `suppress` hides the list (for example after a pick, until
// the text changes again).

export interface Suggestion {
  id: string;
  label: string;
  detail?: string;
}

type Props = {
  value: string;
  onChange: (text: string) => void;
  onPick: (item: Suggestion) => void;
  suggest: (text: string) => Suggestion[];
  suppress?: boolean;
  ariaLabel: string;
  placeholder?: string;
  /** Called on Enter or Tab when no suggestion is being taken. Return true to stop a Tab's default (Enter never submits the page it is on). */
  onLeave?: (key: "Enter" | "Tab") => boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  inputRef?: (element: HTMLInputElement | null) => void;
  inputClassName?: string;
  invalid?: boolean;
  autoCapitalize?: "words" | "off";
  maxLength?: number;
};

export function Combobox({
  value,
  onChange,
  onPick,
  suggest,
  suppress = false,
  ariaLabel,
  placeholder,
  onLeave,
  onBlur,
  onFocus,
  inputRef,
  inputClassName,
  invalid,
  autoCapitalize = "words",
  maxLength,
}: Props) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [arrowed, setArrowed] = useState<number | null>(null);

  const options = focused && !suppress ? suggest(value) : [];
  const open = options.length > 0;
  const active = arrowed ?? (options.length === 1 ? 0 : -1);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const plainTab = event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    if (event.key === "Enter" && open && active >= 0 && options[active] !== undefined) {
      event.preventDefault();
      setArrowed(null);
      onPick(options[active]);
    } else if (event.key === "Enter") {
      event.preventDefault(); // Enter never submits the page it is on
      onLeave?.("Enter");
    } else if (plainTab) {
      if (onLeave?.("Tab") ?? false) event.preventDefault();
    } else if (open && event.key === "ArrowDown") {
      event.preventDefault();
      setArrowed(active < options.length - 1 ? active + 1 : 0);
    } else if (open && event.key === "ArrowUp") {
      event.preventDefault();
      setArrowed(active > 0 ? active - 1 : options.length - 1);
    }
  }

  return (
    <div className={styles.root}>
      <input
        ref={inputRef}
        className={inputClassName}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoCapitalize={autoCapitalize}
        spellCheck={false}
        enterKeyHint="next"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(event) => {
          setArrowed(null);
          onChange(event.target.value);
        }}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          setArrowed(null);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul className={styles.options} role="listbox" id={listId} aria-label="Suggestions">
          {options.map((item, at) => (
            <li
              key={item.id}
              id={`${listId}-opt-${at}`}
              role="option"
              aria-selected={at === active}
              className={cx(styles.option, at === active && styles.optionActive)}
              onMouseDown={(event) => {
                event.preventDefault();
                setArrowed(null);
                onPick(item);
              }}
            >
              <span>{item.label}</span>
              {item.detail ? <span className={styles.optionDetail}>{item.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
