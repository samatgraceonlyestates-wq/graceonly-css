"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import { VISIT_LIMITS, VISIT_REASONS, VISITOR_TYPES, type VisitCorrectionKind } from "@/lib/visits";
import { correctVisitAction, type VisitActionState } from "../actions";
import styles from "./VisitCorrect.module.css";

// UNDESIGNED (not in Figma). Correcting ONE visit, the same discipline as attendance: every
// correction needs a REASON (required box, no default text), records who and when, and the
// visit is marked "Corrected" wherever it is listed. The VERSION of the visit when she opened
// the panel goes back with the form, so a change by the other front-desk person meanwhile is
// refused cleanly. A removed visit can only be restored. The server decides everything; its
// message is shown here.

export type VisitState = "open" | "closed" | "auto" | "removed";

type Choice = { kind: VisitCorrectionKind; label: string };

function choicesFor(state: VisitState, isClient: boolean, canChangeType: boolean): Choice[] {
  if (state === "removed") return [{ kind: "restore", label: "Restore this visit" }];
  const choices: Choice[] = [{ kind: "checkin", label: "Change check-in time" }];
  if (state === "closed") choices.push({ kind: "checkout", label: "Change check-out time" }, { kind: "reopen", label: "Reopen: undo check-out" });
  if (state === "auto") choices.push({ kind: "checkout", label: "Add the time they left" }, { kind: "reopen", label: "Reopen: still here" });
  choices.push({ kind: "reason", label: "Change the reason" }, { kind: "toSee", label: "Change who they came to see" });
  if (canChangeType) choices.push({ kind: "type", label: "Change the visitor type" });
  if (!isClient) choices.push({ kind: "name", label: "Fix their name" }, { kind: "phone", label: "Fix their phone" });
  choices.push({ kind: "void", label: "Remove: entered wrongly" });
  return choices;
}

const PLACEHOLDER: Partial<Record<VisitCorrectionKind, string>> = {
  void: "e.g. checked in the wrong person",
  restore: "e.g. removed by mistake",
  checkin: "e.g. they arrived at 10:05",
  checkout: "e.g. they left at 11:30",
  reopen: "e.g. checked out the wrong visitor",
};

export function VisitCorrect({
  visitId,
  version,
  name,
  state,
  isClient,
  canChangeType,
  current,
}: {
  visitId: string;
  /** The visit's version as of this render. */
  version: string;
  name: string;
  state: VisitState;
  isClient: boolean;
  /** Only a visit that was never looked up (a non-client type) can change type. */
  canChangeType: boolean;
  current: { timeIn: string; timeOut: string | null; reasonCode: string; typeCode: string; toSee: string; name: string; phone: string };
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<VisitCorrectionKind | null>(null);
  const [openedVersion, setOpenedVersion] = useState(version);
  const [time, setTime] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [result, action, saving] = useActionState<VisitActionState, FormData>(correctVisitAction, { status: "idle" });

  // A save that worked closes the panel: the page now shows the change and the "Corrected"
  // mark, which is the confirmation. Left open, it would hold the OLD version.
  const [handled, setHandled] = useState(result);
  if (result !== handled) {
    setHandled(result);
    if (result.status === "done") {
      setOpen(false);
      setKind(null);
    }
  }

  function start() {
    setOpenedVersion(version); // the one she is looking at NOW
    setKind(state === "removed" ? "restore" : null);
    setReason("");
    setOpen(true);
  }

  function choose(next: VisitCorrectionKind) {
    setKind(next);
    setTime(next === "checkin" ? current.timeIn : next === "checkout" ? (current.timeOut ?? "") : "");
    setValue(
      next === "reason"
        ? current.reasonCode
        : next === "type"
          ? current.typeCode
          : next === "toSee"
            ? current.toSee
            : next === "name"
              ? current.name
              : next === "phone"
                ? current.phone
                : "",
    );
  }

  return (
    <Card as="section" padding="md" aria-labelledby="correct-heading" className={styles.card}>
      <div className={styles.head}>
        <h2 id="correct-heading" className={styles.title}>
          {state === "removed" ? "Removed visit" : "Corrections"}
        </h2>
        <Button variant="row-action" onClick={() => (open ? setOpen(false) : start())} aria-expanded={open}>
          {open ? "Close" : state === "removed" ? "Restore…" : "Correct…"}
        </Button>
      </div>

      {result.status === "done" && !open ? (
        <Notice tone="info" role="status">
          <p>{result.message}</p>
        </Notice>
      ) : null}

      {open ? (
        <div className={styles.panel} role="group" aria-label={`Correct ${name}'s visit`}>
          <p className={styles.note}>
            {state === "removed"
              ? `${name}'s visit was removed and counts for nothing. Restoring it needs a reason, and is refused if they are checked in again meanwhile.`
              : `Every correction needs a reason, and the visit will show that it was changed, by you, and why.`}
          </p>

          {version !== openedVersion ? (
            <p className={styles.error} role="alert">
              This visit changed after you opened this. Close it and open it again to see the latest.
            </p>
          ) : null}

          {state !== "removed" ? (
            <div className={styles.choices}>
              {choicesFor(state, isClient, canChangeType).map((choice) => (
                <Button key={choice.kind} variant="row-action" onClick={() => choose(choice.kind)} aria-expanded={kind === choice.kind}>
                  {choice.label}
                </Button>
              ))}
            </div>
          ) : null}

          {kind !== null ? (
            <form action={action} className={styles.form}>
              <input type="hidden" name="visitId" value={visitId} />
              <input type="hidden" name="version" value={openedVersion} />
              <input type="hidden" name="kind" value={kind} />

              {kind === "checkin" || kind === "checkout" ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="fix-time">
                    {kind === "checkin" ? "New check-in time" : "Time they left"}
                  </label>
                  <input
                    id="fix-time"
                    className={styles.time}
                    name="time"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    placeholder="1030"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                </div>
              ) : null}

              {kind === "reason" || kind === "type" ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="fix-value">
                    {kind === "reason" ? "Reason for the visit" : "Visitor type"}
                  </label>
                  <select id="fix-value" className={styles.select} name="value" value={value} onChange={(event) => setValue(event.target.value)}>
                    {(kind === "reason" ? VISIT_REASONS : VISITOR_TYPES.filter((type) => type.code !== "CLIENT")).map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {kind === "toSee" || kind === "name" || kind === "phone" ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="fix-value">
                    {kind === "toSee" ? "Here to see (empty to clear)" : kind === "name" ? "Their name" : "Their phone (empty to remove)"}
                  </label>
                  <input
                    id="fix-value"
                    className={styles.text}
                    name="value"
                    type="text"
                    inputMode={kind === "phone" ? "tel" : "text"}
                    autoComplete="off"
                    autoFocus
                    maxLength={kind === "phone" ? 40 : kind === "name" ? VISIT_LIMITS.maxNameLength : VISIT_LIMITS.maxToSeeLength}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>
              ) : null}

              <div className={styles.reasonField}>
                <label className={styles.label} htmlFor="fix-reason">
                  Why? (required)
                </label>
                <input
                  id="fix-reason"
                  className={styles.text}
                  name="reason"
                  type="text"
                  autoComplete="off"
                  maxLength={VISIT_LIMITS.maxReasonLength}
                  required
                  autoFocus={!["checkin", "checkout", "toSee", "name", "phone"].includes(kind)}
                  placeholder={PLACEHOLDER[kind] ?? "e.g. typed wrong at check-in"}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>

              <Button type="submit" size="compact" disabled={saving}>
                {saving ? "Saving…" : kind === "void" ? "Remove this visit" : kind === "restore" ? "Restore this visit" : "Save correction"}
              </Button>
            </form>
          ) : null}

          {kind === "void" ? (
            <p className={styles.note}>
              This takes the visit off every list and count. It stays on file, with your reason and your name, and can be restored.
            </p>
          ) : null}
          {kind === "name" || kind === "phone" ? (
            <p className={styles.note}>This changes the visitor&apos;s record, so it shows on all of their visits.</p>
          ) : null}

          {result.status === "error" ? (
            <p className={styles.error} role="alert">
              {result.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
