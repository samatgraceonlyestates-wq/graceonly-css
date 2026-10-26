"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { timeLabel } from "@/lib/departureTime";
import { GATE_ANSWER_TEXT, HANDOVER_DOCUMENTS, HANDOVER_LIMITS, type GateAnswer } from "@/lib/handovers";
import { recordHandoverAction, withdrawHandoverAction, type HandoverActionState } from "./handoverActions";
import styles from "./HandoverCard.module.css";

// UNDESIGNED (not in Figma). DOCUMENT HANDOVERS, on the visit that produced them (handovers.ts).
//
// SILENCE IS NOT PERMISSION. Nothing on this card says a document MAY be handed over: the
// release decision is the portal's, asked again at the moment of recording. A record made while
// the gate was off or the portal could not answer says, wherever it is shown, that NOBODY
// VERIFIED it. When the gate is on and the portal refuses, the record is NOT written.
//
// A wrong record is never edited: it is WITHDRAWN (a correction appended, with a reason) and
// stays in the list, marked, with its correction; the right one is recorded again, naming it.

export type HandoverItemView = { code: string; label: string; quantity: number };
export type HandoverCardRow = {
  id: string;
  releasedAt: string;
  releasedByName: string | null;
  purchaseId: string | null;
  gateAnswer: GateAnswer;
  gateRequestId: string | null;
  note: string | null;
  items: HandoverItemView[];
  correction: { reason: string; correctedAt: string; correctedByName: string | null } | null;
  replacedBy: { id: string; releasedAt: string } | null;
  replaces: { id: string; releasedAt: string; reason: string | null } | null;
};

const at = (iso: string) => timeLabel(new Date(iso));

function Withdraw({ visitId, handoverId }: { visitId: string; handoverId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState<HandoverActionState, FormData>(withdrawHandoverAction, { status: "idle" });
  if (!open) {
    return (
      <Button variant="row-action" onClick={() => setOpen(true)}>
        Correct…
      </Button>
    );
  }
  return (
    <form action={action} className={styles.withdraw}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="handoverId" value={handoverId} />
      <p className={styles.note}>
        A record cannot be changed. Withdrawing it keeps it here, marked with your reason, and it stops counting as a release. If
        the handover did happen differently, record the right one after.
      </p>
      <label className={styles.label} htmlFor={`withdraw-${handoverId}`}>
        What is wrong with this record? (required)
      </label>
      <input
        id={`withdraw-${handoverId}`}
        className={styles.text}
        name="reason"
        type="text"
        autoComplete="off"
        required
        autoFocus
        maxLength={HANDOVER_LIMITS.maxReasonLength}
        placeholder="e.g. two copies were handed over, not one"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className={styles.actions}>
        <Button type="submit" size="compact" disabled={pending}>
          {pending ? "Saving…" : "Withdraw this record"}
        </Button>
        <Button variant="row-action" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state.status === "error" ? (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function HandoverCard({
  visitId,
  canRecord,
  notClientText,
  purchases,
  handovers,
}: {
  visitId: string;
  /** A client's visit that is not removed. */
  canRecord: boolean;
  /** Why nothing can be recorded on this visit, when it is not a client's. */
  notClientText: string | null;
  /** The client's purchases as the portal listed them on this page load, or null if it could not. */
  purchases: { id: string; label: string }[] | null;
  handovers: HandoverCardRow[];
}) {
  const [open, setOpen] = useState(false);
  const [replaces, setReplaces] = useState<HandoverCardRow | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  // Controlled: React resets an uncontrolled form after its action, which would empty the
  // quantities before "Record it as NOT VERIFIED" sends them again.
  const [purchaseId, setPurchaseId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [resubmit, setResubmit] = useState(0);
  const form = useRef<HTMLFormElement | null>(null);
  const [state, action, pending] = useActionState<HandoverActionState, FormData>(recordHandoverAction, { status: "idle" });

  // "Record it as NOT VERIFIED": the same form again, now saying she has confirmed it. The portal
  // is asked again by that save too; its answer then is the one stored.
  useEffect(() => {
    if (resubmit > 0) form.current?.requestSubmit();
  }, [resubmit]);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    setAcknowledge(false);
    if (state.status === "done") {
      setOpen(false);
      setReplaces(null);
    }
  }

  const live = handovers.filter((handover) => handover.correction === null).length;
  const purchaseLabel = (id: string | null) =>
    id === null ? "No purchase recorded" : (purchases?.find((purchase) => purchase.id === id)?.label ?? "A purchase the portal did not list on this page load");
  const releasedAt = (id: string) => handovers.find((handover) => handover.id === id)?.releasedAt;

  function start(replacing: HandoverCardRow | null) {
    setReplaces(replacing);
    setPurchaseId(replacing?.purchaseId ?? (purchases?.length === 1 ? purchases[0]!.id : ""));
    setQuantities({});
    setNote("");
    setOpen(true);
  }

  return (
    <Card as="section" padding="md" aria-labelledby="handovers-heading" className={styles.card}>
      <div className={styles.head}>
        <h2 id="handovers-heading" className={styles.title}>
          Documents handed over <span className={styles.count}>{live}</span>
        </h2>
        {canRecord && !open ? (
          <Button variant="row-action" onClick={() => start(null)}>
            Record a handover…
          </Button>
        ) : null}
      </div>

      {notClientText !== null ? <p className={styles.note}>{notClientText}</p> : null}

      {state.status === "done" && !open ? (
        <Notice tone="info" role="status">
          <p>{state.message}</p>
        </Notice>
      ) : null}

      {handovers.length === 0 && notClientText === null ? <p className={styles.note}>No documents have been recorded as handed over on this visit.</p> : null}

      {handovers.length > 0 ? (
        <ul className={styles.list}>
          {handovers.map((handover) => {
            const text = GATE_ANSWER_TEXT[handover.gateAnswer];
            const withdrawn = handover.correction !== null;
            return (
              <li key={handover.id} className={withdrawn ? `${styles.item} ${styles.withdrawn}` : styles.item}>
                <div className={styles.line}>
                  <StatusPill tone={text.tone}>{text.pill}</StatusPill>
                  {withdrawn ? <StatusPill tone="steel">Withdrawn</StatusPill> : null}
                  <span className={styles.items}>{handover.items.map((item) => `${item.label} × ${item.quantity}`).join(" · ")}</span>
                </div>
                <p className={styles.facts}>
                  Handed over at {at(handover.releasedAt)} by {handover.releasedByName ?? "someone"} · {purchaseLabel(handover.purchaseId)}
                </p>
                <p className={text.verified ? styles.facts : styles.unverified}>
                  {text.detail}
                  {handover.gateRequestId ? ` Portal reference ${handover.gateRequestId}.` : ""}
                </p>
                {handover.note ? <p className={styles.facts}>Note: {handover.note}</p> : null}
                {handover.replaces ? (
                  <p className={styles.facts}>
                    Replaces the record of {at(handover.replaces.releasedAt)}
                    {handover.replaces.reason ? ` (withdrawn: “${handover.replaces.reason}”)` : ""}.
                  </p>
                ) : null}
                {handover.correction ? (
                  <p className={styles.correction}>
                    Withdrawn at {at(handover.correction.correctedAt)} by {handover.correction.correctedByName ?? "someone"}:{" "}
                    <q>{handover.correction.reason}</q>. It no longer counts as a release.
                    {handover.replacedBy ? ` Replaced by the record of ${at(handover.replacedBy.releasedAt)}.` : ""}
                  </p>
                ) : null}
                <div className={styles.actions}>
                  {!withdrawn ? <Withdraw visitId={visitId} handoverId={handover.id} /> : null}
                  {withdrawn && handover.replacedBy === null && canRecord && !open ? (
                    <Button variant="row-action" onClick={() => start(handover)}>
                      Record the right one…
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open ? (
        <form ref={form} action={action} className={styles.form} aria-label="Record a handover">
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="replacesHandoverId" value={replaces?.id ?? ""} />
          <input type="hidden" name="acknowledgeUnverified" value={acknowledge ? "yes" : ""} />

          {replaces ? (
            <p className={styles.note}>
              Recording the right handover, to replace the withdrawn record of {at(releasedAt(replaces.id) ?? replaces.releasedAt)}.
            </p>
          ) : null}

          {purchases === null ? (
            <Notice tone="limited" role="status">
              <p>The portal could not list their purchases just now, so no purchase will be recorded with this handover.</p>
            </Notice>
          ) : purchases.length === 0 ? (
            <p className={styles.note}>The portal lists no purchases for this client.</p>
          ) : (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="handover-purchase">
                Which purchase
              </label>
              <select
                id="handover-purchase"
                className={styles.select}
                name="purchaseId"
                value={purchaseId}
                onChange={(event) => setPurchaseId(event.target.value)}
              >
                {purchases.length > 1 ? <option value="">Choose…</option> : null}
                {purchases.map((purchase) => (
                  <option key={purchase.id} value={purchase.id}>
                    {purchase.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <fieldset className={styles.documents}>
            <legend className={styles.label}>What was handed over: how many of each</legend>
            {HANDOVER_DOCUMENTS.map((document) => (
              <label key={document.code} className={styles.document}>
                <span>{document.label}</span>
                <input
                  className={styles.quantity}
                  name={`qty-${document.code}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={HANDOVER_LIMITS.maxQuantity}
                  placeholder="0"
                  aria-label={`How many ${document.label}`}
                  value={quantities[document.code] ?? ""}
                  onChange={(event) => setQuantities((current) => ({ ...current, [document.code]: event.target.value }))}
                />
              </label>
            ))}
          </fieldset>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="handover-note">
              Note (optional)
            </label>
            <input
              id="handover-note"
              className={styles.text}
              name="note"
              type="text"
              autoComplete="off"
              maxLength={HANDOVER_LIMITS.maxNoteLength}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <p className={styles.note}>
            When you save, the portal&apos;s release-check is asked again, now, and its answer is stored with the record. If it refuses any
            document, nothing is recorded. If its gate is off or it cannot answer, you are asked to confirm a release nobody verified.
          </p>

          <div className={styles.actions}>
            <Button type="submit" size="compact" disabled={pending}>
              {pending ? "Asking the portal…" : "Check with the portal and record"}
            </Button>
            <Button
              variant="row-action"
              onClick={() => {
                setOpen(false);
                setReplaces(null);
              }}
            >
              Cancel
            </Button>
          </div>

          {state.status === "blocked" ? (
            <Notice tone="failure" title="Not recorded: the portal refused" role="alert">
              <p>{state.message}</p>
              <ul className={styles.refusals}>
                {state.refused.map((refusal) => (
                  <li key={refusal.code}>
                    {refusal.label}: {refusal.why}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {state.status === "unverified" ? (
            <Notice tone="limited" title="Nobody can verify this release" role="alert">
              <p>{state.message}</p>
              <div className={styles.actions}>
                <Button
                  size="compact"
                  disabled={pending}
                  onClick={() => {
                    setAcknowledge(true);
                    setResubmit((count) => count + 1);
                  }}
                >
                  Record it as NOT VERIFIED
                </Button>
              </div>
            </Notice>
          ) : null}

          {state.status === "error" ? (
            <Notice tone="failure" title="Not recorded" role="alert">
              <p>{state.message}</p>
            </Notice>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}
