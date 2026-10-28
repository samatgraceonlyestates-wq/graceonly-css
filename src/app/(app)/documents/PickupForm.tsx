"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import { HANDOVER_DOCUMENTS, HANDOVER_LIMITS } from "@/lib/handovers";
import { recordPickupAction, searchClientsForPickupAction } from "./actions";
import type { PickupSearchCandidate, PickupSearchState, RecordPickupState } from "./types";
import styles from "./page.module.css";

const IDLE_SEARCH: PickupSearchState = { status: "idle" };
const IDLE_RECORD: RecordPickupState = { status: "idle" };

export function PickupForm() {
  const [picked, setPicked] = useState<PickupSearchCandidate | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");

  const [search, submitSearch, searching] = useActionState(
    async (previous: PickupSearchState, formData: FormData): Promise<PickupSearchState> => {
      setPicked(null);
      setSelectedPurchase("");
      setQuantities({});
      return searchClientsForPickupAction(previous, formData);
    },
    IDLE_SEARCH,
  );

  const [recordState, submitRecord, recording] = useActionState(recordPickupAction, IDLE_RECORD);

  return (
    <div className={styles.wrap}>
      <Card className={styles.card}>
        <h2 className={styles.heading}>1. Find the client</h2>
        <form action={submitSearch} className={styles.searchRow}>
          <input
            type="text"
            name="name"
            placeholder="Search by client name..."
            className={styles.input}
            autoComplete="off"
            required
          />
          <Button type="submit" size="compact" disabled={searching}>
            {searching ? "Searching..." : "Search"}
          </Button>
        </form>

        {search.status === "error" ? (
          <Notice tone="failure" role="alert"><p>{search.message}</p></Notice>
        ) : null}

        {search.status === "results" && search.candidates.length === 0 ? (
          <p className={styles.empty}>No clients found. Try a different name.</p>
        ) : null}

        {search.status === "results" && search.candidates.length > 0 ? (
          <ul className={styles.candidates}>
            {search.candidates.map((c) => (
              <li key={c.clientId} className={styles.candidate}>
                <button
                  type="button"
                  className={`${styles.candidateButton}${picked?.clientId === c.clientId ? ` ${styles.candidateSelected}` : ""}`}
                  onClick={() => {
                    setPicked(c);
                    setSelectedPurchase(c.purchases.length === 1 ? c.purchases[0]!.purchaseId : "");
                  }}
                >
                  <span className={styles.candidateName}>{c.displayName}</span>
                  {c.purchases.length > 0 ? (
                    <span className={styles.candidateSub}>
                      {c.purchases.map((p) => p.label).join(" · ")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {picked ? <p className={styles.picked}>Selected: {picked.displayName}</p> : null}
      </Card>

      {picked ? (
        <Card className={styles.card}>
          <h2 className={styles.heading}>2. Record the pickup</h2>
          <form action={submitRecord} className={styles.form}>
            <input type="hidden" name="clientId" value={picked.clientId} />
            <input type="hidden" name="clientName" value={picked.displayName} />

            {picked.purchases.length > 0 ? (
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="pickup-purchase">Which purchase</label>
                <select
                  id="pickup-purchase"
                  className={styles.select}
                  name="purchaseId"
                  value={selectedPurchase}
                  onChange={(e) => setSelectedPurchase(e.target.value)}
                >
                  {picked.purchases.length > 1 ? <option value="">Choose...</option> : null}
                  {picked.purchases.map((p) => (
                    <option key={p.purchaseId} value={p.purchaseId}>{p.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className={styles.empty}>No purchases found for this client.</p>
            )}

            <fieldset className={styles.documents}>
              <legend className={styles.label}>What was handed over: how many of each</legend>
              {HANDOVER_DOCUMENTS.map((doc) => (
                <label key={doc.code} className={styles.document}>
                  <span>{doc.label}</span>
                  <input
                    className={styles.quantity}
                    name={`qty-${doc.code}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={HANDOVER_LIMITS.maxQuantity}
                    placeholder="0"
                    aria-label={`How many ${doc.label}`}
                    value={quantities[doc.code] ?? ""}
                    onChange={(e) => setQuantities((q) => ({ ...q, [doc.code]: e.target.value }))}
                  />
                </label>
              ))}
            </fieldset>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="pickup-received-by">Received by (optional)</label>
              <input
                id="pickup-received-by"
                className={styles.input}
                name="receivedByName"
                type="text"
                autoComplete="off"
                maxLength={200}
                placeholder="Name of person collecting"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="pickup-note">Note (optional)</label>
              <input
                id="pickup-note"
                className={styles.input}
                name="note"
                type="text"
                autoComplete="off"
                maxLength={HANDOVER_LIMITS.maxNoteLength}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <p className={styles.note}>
              This creates a visit (document collection) and records the handover in one step.
              The portal&apos;s release-check is asked at save time.
            </p>

            <Button type="submit" size="compact" disabled={recording}>
              {recording ? "Recording..." : "Record pickup and create visit"}
            </Button>

            {recordState.status === "error" ? (
              <Notice tone="failure" role="alert"><p>{recordState.message}</p></Notice>
            ) : null}
          </form>
        </Card>
      ) : null}
    </div>
  );
}
