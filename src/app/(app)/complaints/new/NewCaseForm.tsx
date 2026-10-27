"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import type { PortalCaseType } from "@/lib/portal";
import { createCaseAction, loadCaseTypesAction, searchClientsAction } from "./actions";
import type { CaseSearchCandidate, CaseSearchState, CreateCaseState } from "./types";
import styles from "./NewCaseForm.module.css";

const IDLE_SEARCH: CaseSearchState = { status: "idle" };
const IDLE_CREATE: CreateCaseState = { status: "idle" };

export function NewCaseForm() {
  const [picked, setPicked] = useState<CaseSearchCandidate | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<string>("");
  const [caseTypes, setCaseTypes] = useState<PortalCaseType[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const [search, submitSearch, searching] = useActionState(
    async (previous: CaseSearchState, formData: FormData): Promise<CaseSearchState> => {
      setPicked(null);
      setSelectedPurchase("");
      return searchClientsAction(previous, formData);
    },
    IDLE_SEARCH,
  );

  const [createState, submitCreate, creating] = useActionState(createCaseAction, IDLE_CREATE);

  const [, startTypesLoad] = useTransition();

  useEffect(() => {
    startTypesLoad(async () => {
      const types = await loadCaseTypesAction();
      setCaseTypes(types);
    });
  }, []);

  const typeInfo = caseTypes.find((t) => t.code === selectedType);
  const needsPurchase = typeInfo?.targetsPurchase ?? false;

  return (
    <div className={styles.wrap}>
      {/* Step 1: Find the client */}
      <Card className={styles.card}>
        <h2 className={styles.heading}>1. Find the client</h2>
        <form action={submitSearch} className={styles.searchRow}>
          <input
            type="text"
            name="name"
            placeholder="Search by client name…"
            className={styles.input}
            autoComplete="off"
            required
          />
          <Button type="submit" size="compact" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </form>

        {search.status === "error" ? (
          <Notice tone="failure" role="alert">
            <p>{search.message}</p>
          </Notice>
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
                  className={`${styles.candidateButton} ${picked?.clientId === c.clientId ? styles.candidateSelected : ""}`}
                  onClick={() => {
                    setPicked(c);
                    setSelectedPurchase(c.purchases.length === 1 ? c.purchases[0].purchaseId : "");
                  }}
                >
                  <span className={styles.candidateName}>{c.displayName}</span>
                  {c.purchases.length > 0 ? (
                    <span className={styles.candidateSub}>
                      {c.purchases.map((p) => p.label).join(", ")}
                    </span>
                  ) : (
                    <span className={styles.candidateSub}>No purchases</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {picked ? (
          <p className={styles.picked}>Selected: <strong>{picked.displayName}</strong></p>
        ) : null}
      </Card>

      {/* Step 2: Case details */}
      {picked ? (
        <Card className={styles.card}>
          <h2 className={styles.heading}>2. Case details</h2>
          <form action={submitCreate} className={styles.form}>
            <input type="hidden" name="clientId" value={picked.clientId} />

            {picked.purchases.length > 1 ? (
              <div className={styles.fieldGroup}>
                <label htmlFor="purchaseId" className={styles.label}>Purchase</label>
                <select
                  id="purchaseId"
                  name="purchaseId"
                  className={styles.select}
                  value={selectedPurchase}
                  onChange={(e) => setSelectedPurchase(e.target.value)}
                >
                  <option value="">Choose a purchase</option>
                  {picked.purchases.map((p) => (
                    <option key={p.purchaseId} value={p.purchaseId}>{p.label}</option>
                  ))}
                </select>
              </div>
            ) : picked.purchases.length === 1 ? (
              <input type="hidden" name="purchaseId" value={picked.purchases[0].purchaseId} />
            ) : null}

            <div className={styles.fieldGroup}>
              <label htmlFor="typeCode" className={styles.label}>Case type</label>
              <select
                id="typeCode"
                name="typeCode"
                className={styles.select}
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                required
              >
                <option value="">Choose a type</option>
                {caseTypes
                  .filter((t) => t.code !== "REALTOR_CONDUCT")
                  .map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label ?? t.code} ({t.kind})
                    </option>
                  ))}
              </select>
              {needsPurchase && !selectedPurchase && picked.purchases.length > 0 ? (
                <p className={styles.hint}>This type requires a purchase to be selected.</p>
              ) : null}
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="subject" className={styles.label}>Subject</label>
              <input
                id="subject"
                type="text"
                name="subject"
                className={styles.input}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary…"
                required
                autoComplete="off"
              />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="description" className={styles.label}>Description</label>
              <textarea
                id="description"
                name="description"
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Full details of the complaint…"
                required
                rows={4}
              />
            </div>

            {createState.status === "error" ? (
              <Notice tone="failure" role="alert">
                <p>{createState.message}</p>
              </Notice>
            ) : null}

            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create case"}
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
