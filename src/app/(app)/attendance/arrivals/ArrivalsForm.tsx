"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import { parseClockTime } from "@/lib/clockTime";
import { cx } from "@/lib/cx";
import { formatIsoDate, formatLongDate } from "@/lib/format";
import { matchName, personDetails, suggest, type RosterName } from "@/lib/rosterMatch";
import { saveArrivalsAction, type ArrivalsState } from "./actions";
import styles from "./page.module.css";

// UNDESIGNED: this screen is not in Figma. Built from the shared components and
// tokens only; replace it when a design exists.
//
// KEYBOARD FIRST. She is copying twenty or thirty lines off a page, so the whole
// sheet is typed without the mouse:
//   Enter or Tab   on to the next field; past the last field a new row appears
//   Arrow keys     move through the name suggestions; Enter takes the highlighted one
//                  (a single suggestion is already highlighted, so "divi" Enter is enough)
//   Enter          never submits the form: only the Save button does
//   A close name   leaving the name field (Enter or Tab) with a name close to someone on
//                  the roster moves focus INTO the "did you mean" prompt: Y takes the
//                  first person offered (1, 2, 3 take the others), N says a different
//                  person, and focus then goes on to the time. No mouse, no Tab hunt.
//   Never signed   on an earlier day, N in the Time out box says "Never signed out"
//                  (N again, or Backspace, undoes it). Phones tick the box instead.
// Tab never takes a suggestion for her, so a name she meant to type in full is not
// swapped for another. The names she types are checked against the roster with the
// same rules as the server (rosterMatch.ts), so a near-duplicate is flagged here
// as she leaves the field, and again, authoritatively, when the page is saved.

type Field = "name" | "timeIn" | "timeOut";

interface RowState {
  key: number;
  name: string;
  personId: string | null;
  timeIn: string;
  timeOut: string;
  /** Earlier day only: instead of a time out, they never signed out. */
  neverSignedOut: boolean;
  confirmNew: boolean;
  /** She has been in and out of the name field: only then is the roster hint shown. */
  touched: boolean;
}

interface Flag {
  field: Field | "row";
  message: string;
}

const START_ROWS = 8;
const MORE_ROWS = 5;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const blankRow = (generation: number, index: number): RowState => ({
  key: generation * 1000 + index,
  name: "",
  personId: null,
  timeIn: "",
  timeOut: "",
  neverSignedOut: false,
  confirmNew: false,
  touched: false,
});

const isBlank = (row: RowState) => row.name.trim() === "" && row.timeIn.trim() === "" && row.timeOut.trim() === "" && !row.neverSignedOut;

export function ArrivalsForm({ roster, today }: { roster: RosterName[]; today: string }) {
  const listId = useId();
  // What tells two people of one name apart (department, when added): shown in the
  // suggestions and in the "did you mean" prompt.
  const details = useMemo(() => personDetails(roster), [roster]);
  const [generation, setGeneration] = useState(0);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<RowState[]>(() => Array.from({ length: START_ROWS }, (_, i) => blankRow(0, i)));
  const [state, formAction, pending] = useActionState<ArrivalsState, FormData>(saveArrivalsAction, { status: "idle" });

  // What the last save said about each row. Editing a row clears what was said about it.
  const [handled, setHandled] = useState<ArrivalsState>(state);
  const [flags, setFlags] = useState<Record<number, Flag[]>>({});

  // Where the cursor is, and which suggestion (if any) she has moved to with the arrows.
  const [focused, setFocused] = useState<{ index: number; field: Field } | null>(null);
  const [arrowed, setArrowed] = useState<number | null>(null);

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const prompts = useRef(new Map<number, HTMLDivElement>());
  // "3:name", "3:timeIn", "3:timeOut" or "prompt:3": where focus goes after the next render.
  const pendingFocus = useRef<string | null>(null);
  const [, bump] = useState(0);

  const isEarlier = DATE_SHAPE.test(date) && date < today;
  const isFuture = DATE_SHAPE.test(date) && date > today;
  const fields: Field[] = isEarlier ? ["name", "timeIn", "timeOut"] : ["name", "timeIn"];
  const filled = rows.filter((row) => !isBlank(row)).length;

  // Adjusting state when the action's result arrives (React's "derive state from a
  // changed value" pattern, rather than an effect).
  if (state !== handled) {
    setHandled(state);
    if (state.status === "saved") {
      setGeneration(generation + 1);
      setRows(Array.from({ length: START_ROWS }, (_, i) => blankRow(generation + 1, i)));
      setFlags({});
      setReason("");
    } else if (state.status === "refused") {
      const next: Record<number, Flag[]> = {};
      for (const problem of state.problems) (next[problem.row] ??= []).push({ field: problem.field, message: problem.message });
      for (const confirmation of state.confirmations) {
        (next[confirmation.row] ??= []).push({ field: "name", message: "Say whether this is a different person." });
      }
      setFlags(next);
    }
  }

  // A fresh sheet after a save: back to the first name, ready for the next page.
  useEffect(() => {
    if (state.status === "saved") inputs.current.get("0:name")?.focus();
  }, [state]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target !== null) {
      pendingFocus.current = null;
      if (target.startsWith("prompt:")) prompts.current.get(Number(target.slice(7)))?.querySelector("button")?.focus();
      else inputs.current.get(target)?.focus();
    }
  });

  const register = (id: string) => (element: HTMLInputElement | null) => {
    if (element) inputs.current.set(id, element);
    else inputs.current.delete(id);
  };
  const focusCell = (index: number, field: Field) => inputs.current.get(`${index}:${field}`)?.focus();

  function update(index: number, patch: Partial<RowState>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setFlags((current) => {
      if (current[index] === undefined) return current;
      const rest = { ...current };
      delete rest[index];
      return rest;
    });
  }

  // Leaving the name field turns the roster hint on. It must not clear what the last
  // save said about the row, which update() does, so it is its own small change.
  function markTouched(index: number) {
    setRows((current) => current.map((row, i) => (i === index && !row.touched ? { ...row, touched: true } : row)));
  }

  function addRows(count: number, focusFirst: boolean) {
    if (focusFirst) pendingFocus.current = `${rows.length}:name`;
    setRows((current) => [...current, ...Array.from({ length: count }, (_, i) => blankRow(generation, current.length + i))]);
  }

  function moveOn(index: number, field: Field) {
    const at = fields.indexOf(field);
    const next = fields[at + 1];
    if (next !== undefined) focusCell(index, next);
    else if (index < rows.length - 1) focusCell(index + 1, "name");
    else addRows(1, true);
  }

  function choose(index: number, person: RosterName) {
    update(index, { name: person.name, personId: person.id, confirmNew: false, touched: true });
    setArrowed(null);
  }

  /** She answered the "did you mean" prompt: carry on at the time, in the row's own flow. */
  function answered(index: number) {
    pendingFocus.current = `${index}:timeIn`;
    bump((n) => n + 1);
  }

  /** Move focus into this row's prompt (it is shown first, if it was not already). */
  function askPrompt(index: number) {
    markTouched(index);
    pendingFocus.current = `prompt:${index}`;
    bump((n) => n + 1);
  }

  /** Is this row's name close to someone on the roster, and not yet answered? */
  function needsAnswer(row: RowState): boolean {
    if (row.name.trim() === "" || row.personId !== null || row.confirmNew) return false;
    return matchName(row.name, roster).kind === "close";
  }

  // The prompt's own keys: Y (or 1) the first person offered, 2 and 3 the others, N a
  // different person, Left and Right between the buttons. Enter or Space presses the
  // focused button as usual.
  function onPromptKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number, candidates: RosterName[]) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const pick = key === "y" ? 0 : key >= "1" && key <= "3" ? Number(key) - 1 : -1;
    if (pick >= 0 && candidates[pick] !== undefined) {
      event.preventDefault();
      choose(index, candidates[pick]);
      answered(index);
    } else if (key === "n") {
      event.preventDefault();
      update(index, { confirmNew: true });
      answered(index);
    } else if (key === "arrowright" || key === "arrowleft") {
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll("button")];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at + (key === "arrowright" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number, field: Field, options: RosterName[]) {
    const row = rows[index]!;
    const open = field === "name" && options.length > 0 && row.personId === null;
    const active = arrowed ?? (options.length === 1 ? 0 : -1);
    const plainTab = event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    const takingSuggestion = event.key === "Enter" && open && active >= 0 && options[active] !== undefined;

    // Leaving the name with a close name unanswered: ask, with the keyboard, right here.
    if (field === "name" && (event.key === "Enter" || plainTab) && !takingSuggestion && needsAnswer(row)) {
      event.preventDefault();
      askPrompt(index);
      return;
    }

    // Earlier day, Time out box: N means "Never signed out" (no time), N or Backspace undoes it.
    if (field === "timeOut" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        update(index, { neverSignedOut: !row.neverSignedOut, timeOut: "" });
        return;
      }
      if (row.neverSignedOut && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        update(index, { neverSignedOut: false });
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault(); // Enter never submits the page
      if (takingSuggestion) {
        choose(index, options[active]!);
        moveOn(index, field);
      } else moveOn(index, field);
    } else if (plainTab) {
      // Past the last field of the last row: a fresh row, if this one has anything in it.
      const lastField = fields[fields.length - 1];
      if (field === lastField && index === rows.length - 1 && !isBlank(row)) {
        event.preventDefault();
        addRows(1, true);
      }
    } else if (open && event.key === "ArrowDown") {
      event.preventDefault();
      setArrowed(active < options.length - 1 ? active + 1 : 0);
    } else if (open && event.key === "ArrowUp") {
      event.preventDefault();
      setArrowed(active > 0 ? active - 1 : options.length - 1);
    }
  }

  const payload = JSON.stringify({
    date,
    // An earlier day needs a reason and a time out. Today takes neither, so neither is sent.
    reason: isEarlier ? reason : "",
    rows: rows.map((row) => ({
      name: row.name,
      personId: row.personId,
      timeIn: row.timeIn,
      timeOut: isEarlier ? row.timeOut : "",
      neverSignedOut: isEarlier && row.neverSignedOut,
      confirmNew: row.confirmNew,
    })),
  });

  const refused = state.status === "refused" ? state : null;
  const problemCount = refused ? refused.problems.length + refused.confirmations.length : 0;

  return (
    <form action={formAction} className={styles.form} noValidate>
      <input type="hidden" name="payload" value={payload} />

      {state.status === "saved" ? (
        <Notice tone="info" title="Saved" role="status">
          <p>
            {state.saved} {state.saved === 1 ? "arrival" : "arrivals"} saved for {formatIsoDate(state.date)}.
            {state.newPeople > 0
              ? ` ${state.newPeople} ${state.newPeople === 1 ? "person was" : "people were"} added to the roster.`
              : ""}
          </p>
        </Notice>
      ) : null}
      {refused ? (
        <Notice tone="failure" title="Nothing was saved" role="alert">
          <p>
            {refused.formProblem ??
              (refused.problems.length > 0
                ? `Fix the ${refused.problems.length === 1 ? "row" : "rows"} marked below, then save again.`
                : "Say whether the highlighted names are new people, then save again.")}
            {refused.formProblem === null && refused.problems.length > 0 && refused.confirmations.length > 0
              ? " Some names also need you to say whether they are new people."
              : ""}
          </p>
        </Notice>
      ) : null}

      <Card padding="md" className={styles.controls}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${listId}-date`}>
            Day
          </label>
          <input
            id={`${listId}-date`}
            className={cx(styles.input, styles.dateInput)}
            type="date"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                focusCell(0, "name");
              }
            }}
            aria-describedby={`${listId}-day-note`}
          />
        </div>
        {/* The picker shows the browser's own format (10/21/2026), which read day-first
            is the 10th of December. The day is therefore ALWAYS spelled out here. */}
        <p className={styles.longDate} aria-live="polite">
          {formatLongDate(date) || "Choose a day."}
        </p>
        {isEarlier ? (
          <div className={cx(styles.field, styles.reasonField)}>
            <label className={styles.label} htmlFor={`${listId}-reason`}>
              Why is this being entered late? (required)
            </label>
            <input
              id={`${listId}-reason`}
              className={styles.input}
              type="text"
              value={reason}
              maxLength={500}
              autoComplete="off"
              placeholder="e.g. copied from the book the next morning"
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  focusCell(0, "name");
                }
              }}
            />
          </div>
        ) : null}
        <p id={`${listId}-day-note`} className={cx(styles.note, isFuture && styles.noteError)}>
          {isFuture
            ? "That day has not happened yet and cannot be entered."
            : isEarlier
              ? "An earlier day: also type each person's time out. The reason is kept on every record in this page."
              : "Today. Typing this morning's arrivals later in the day is fine: no reason is needed."}
        </p>
      </Card>

      <Card padding="md" className={styles.sheet}>
        <div className={cx(styles.headings, !isEarlier && styles.today)} aria-hidden="true">
          <span>#</span>
          <span>Name</span>
          <span>Time in</span>
          {isEarlier ? <span>Time out</span> : null}
        </div>

        <ol className={styles.rows}>
          {rows.map((row, index) => {
            const options = focused?.index === index && focused.field === "name" ? suggest(row.name, roster) : [];
            const listOpen = options.length > 0 && row.personId === null;
            const active = arrowed ?? (options.length === 1 ? 0 : -1);
            const match = row.touched && row.name.trim() !== "" ? matchName(row.name, roster) : null;
            const rowFlags = flags[index] ?? [];
            const flagged = (field: Field) => rowFlags.some((flag) => flag.field === field);

            // A time she has finished typing and that cannot be read, said at once.
            const timeError = (field: "timeIn" | "timeOut"): string | null => {
              const value = row[field];
              if (value.trim() === "" || (focused?.index === index && focused.field === field)) return null;
              const parsed = parseClockTime(value);
              return parsed.ok ? null : parsed.message;
            };
            const inError = timeError("timeIn");
            const outError = isEarlier && !row.neverSignedOut ? timeError("timeOut") : null;

            const onTime = (field: "timeIn" | "timeOut") => {
              // 8:15 and 0815 become 08:15, so she sees what was understood. Anything
              // else is left exactly as typed and flagged: never repaired.
              const parsed = parseClockTime(row[field]);
              if (parsed.ok && parsed.hhmm !== row[field]) update(index, { [field]: parsed.hhmm });
              setFocused(null);
            };

            const hint =
              match === null || match.kind === "empty"
                ? null
                : row.personId !== null || (match.kind === "exact" && match.people.length === 1)
                  ? null // a known person needs no line: thirty of them would only bury the exceptions
                  : match.kind === "exact"
                    ? { tone: "warn", text: "Two people have this name. Pick the right one from the list." }
                    : match.kind === "none"
                      ? { tone: "ok", text: "New person: will be added to the roster." }
                      : row.confirmNew
                        ? { tone: "ok", text: `New person, confirmed different from ${match.candidates.map((c) => c.name).join(", ")}.` }
                        : null;
            const prompt = match !== null && match.kind === "close" && row.personId === null && !row.confirmNew ? match : null;

            return (
              <li
                key={row.key}
                className={cx(styles.row, !isEarlier && styles.today, (rowFlags.length > 0 || prompt !== null) && styles.rowFlagged)}
              >
                <span className={styles.num} aria-hidden="true">
                  {index + 1}
                </span>

                <div className={styles.nameCell}>
                  <input
                    ref={register(`${index}:name`)}
                    className={cx(styles.input, flagged("name") && styles.inputError)}
                    type="text"
                    role="combobox"
                    aria-label={`Row ${index + 1} name`}
                    aria-autocomplete="list"
                    aria-expanded={listOpen}
                    aria-controls={listOpen ? `${listId}-list-${index}` : undefined}
                    aria-activedescendant={listOpen && active >= 0 ? `${listId}-${index}-opt-${active}` : undefined}
                    aria-invalid={flagged("name") || undefined}
                    autoComplete="off"
                    autoCapitalize="words"
                    spellCheck={false}
                    enterKeyHint="next"
                    placeholder="Name"
                    value={row.name}
                    onChange={(event) => {
                      setArrowed(null);
                      update(index, { name: event.target.value, personId: null, confirmNew: false });
                    }}
                    onFocus={() => setFocused({ index, field: "name" })}
                    onBlur={() => {
                      setFocused(null);
                      setArrowed(null);
                      if (row.name.trim() !== "") markTouched(index);
                    }}
                    onKeyDown={(event) => onKeyDown(event, index, "name", options)}
                  />
                  {listOpen ? (
                    <ul className={styles.options} role="listbox" id={`${listId}-list-${index}`} aria-label="Matching people">
                      {options.map((person, at) => (
                        <li
                          key={person.id}
                          id={`${listId}-${index}-opt-${at}`}
                          role="option"
                          aria-selected={at === active}
                          className={cx(styles.option, at === active && styles.optionActive)}
                          // mousedown, not click: the input must not lose focus first.
                          onMouseDown={(event) => {
                            event.preventDefault();
                            choose(index, person);
                            focusCell(index, "timeIn");
                          }}
                        >
                          <span>{person.name}</span>
                          {details.get(person.id) ? <span className={styles.optionDept}>{details.get(person.id)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <input
                  ref={register(`${index}:timeIn`)}
                  className={cx(styles.input, styles.timeIn, (flagged("timeIn") || inError !== null) && styles.inputError)}
                  type="text"
                  inputMode="numeric"
                  aria-label={`Row ${index + 1} time in`}
                  aria-invalid={flagged("timeIn") || inError !== null || undefined}
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="0815"
                  value={row.timeIn}
                  onChange={(event) => update(index, { timeIn: event.target.value })}
                  onFocus={() => setFocused({ index, field: "timeIn" })}
                  onBlur={() => onTime("timeIn")}
                  onKeyDown={(event) => onKeyDown(event, index, "timeIn", [])}
                />

                {isEarlier ? (
                  <>
                    <input
                      ref={register(`${index}:timeOut`)}
                      className={cx(
                        styles.input,
                        styles.timeOut,
                        row.neverSignedOut && styles.neverSigned,
                        (flagged("timeOut") || outError !== null) && styles.inputError,
                      )}
                      type="text"
                      inputMode="numeric"
                      aria-label={`Row ${index + 1} time out`}
                      aria-invalid={flagged("timeOut") || outError !== null || undefined}
                      autoComplete="off"
                      enterKeyHint="next"
                      placeholder="1700"
                      // "Never signed out" is shown IN the box, read-only: it is a choice, not a time.
                      readOnly={row.neverSignedOut}
                      value={row.neverSignedOut ? "Never signed out" : row.timeOut}
                      onChange={(event) => update(index, { timeOut: event.target.value })}
                      onFocus={() => setFocused({ index, field: "timeOut" })}
                      onBlur={() => onTime("timeOut")}
                      onKeyDown={(event) => onKeyDown(event, index, "timeOut", [])}
                    />
                    {/* For touch and mouse. The keyboard uses N in the box above, so this is
                        out of the Tab order and the typing flow is not lengthened. */}
                    <label className={styles.neverToggle}>
                      <input
                        type="checkbox"
                        tabIndex={-1}
                        checked={row.neverSignedOut}
                        onChange={(event) => update(index, { neverSignedOut: event.target.checked, timeOut: "" })}
                        aria-label={`Row ${index + 1}: never signed out`}
                      />
                      <span>Never signed out</span>
                    </label>
                  </>
                ) : null}

                {rowFlags.length > 0 || inError !== null || outError !== null ? (
                  <ul className={styles.errors} role="list">
                    {rowFlags
                      .filter((flag) => !(prompt !== null && flag.message === "Say whether this is a different person."))
                      .map((flag) => (
                        <li key={flag.field + flag.message}>{flag.message}</li>
                      ))}
                    {inError !== null && !rowFlags.some((flag) => flag.field === "timeIn") ? <li>Time in: {inError}</li> : null}
                    {outError !== null && !rowFlags.some((flag) => flag.field === "timeOut") ? <li>Time out: {outError}</li> : null}
                  </ul>
                ) : null}

                {prompt !== null ? (
                  <div
                    ref={(element) => {
                      if (element) prompts.current.set(index, element);
                      else prompts.current.delete(index);
                    }}
                    className={styles.prompt}
                    role="group"
                    aria-label={`Row ${index + 1}: is this someone already on the roster?`}
                    onKeyDown={(event) => onPromptKeyDown(event, index, prompt.candidates.slice(0, 3))}
                  >
                    <p>
                      {prompt.candidates.length === 1 ? "Did you mean " : "Did you mean one of these? "}
                      {prompt.candidates.slice(0, 3).map((candidate, at) => (
                        <span key={candidate.id}>
                          {at > 0 ? ", " : ""}
                          <strong>{candidate.name}</strong>
                          {details.get(candidate.id) ? ` (${details.get(candidate.id)})` : ""}
                        </span>
                      ))}
                      ?
                    </p>
                    <div className={styles.promptActions}>
                      {prompt.candidates.slice(0, 3).map((candidate, at) => (
                        <Button
                          key={candidate.id}
                          size="compact"
                          onClick={() => {
                            choose(index, candidate);
                            answered(index);
                          }}
                        >
                          Yes, {candidate.name}
                          {details.get(candidate.id) ? ` · ${details.get(candidate.id)}` : ""}
                          {prompt.candidates.length > 1 ? ` (${at + 1})` : ""}
                        </Button>
                      ))}
                      <Button
                        variant="row-action"
                        onClick={() => {
                          update(index, { confirmNew: true });
                          answered(index);
                        }}
                      >
                        No, a different person
                      </Button>
                    </div>
                    <p className={styles.promptKeys}>
                      Keys: Y for yes{prompt.candidates.length > 1 ? " (or 1, 2, 3)" : ""}, N for a different person.
                    </p>
                  </div>
                ) : hint !== null ? (
                  <p className={cx(styles.hint, hint.tone === "warn" && styles.hintWarn)}>{hint.text}</p>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className={styles.footer}>
          <Button type="submit" disabled={pending || filled === 0}>
            {pending ? "Saving…" : filled === 0 ? "Save" : `Save ${filled} ${filled === 1 ? "arrival" : "arrivals"}`}
          </Button>
          <Button variant="row-action" onClick={() => addRows(MORE_ROWS, false)}>
            Add {MORE_ROWS} rows
          </Button>
          <p className={styles.note}>
            {problemCount > 0 ? `${problemCount} to fix. ` : ""}Nothing is saved until you press Save.
          </p>
        </div>
      </Card>
    </form>
  );
}
