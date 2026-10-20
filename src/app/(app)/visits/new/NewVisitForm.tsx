"use client";

// UNVERIFIED AGAINST FIGMA. Screen 04 (nodes 27:2 / 27:59) was built from a
// written description of the frames, not from the frames themselves: the Figma
// MCP quota was spent. Check spacing, type sizes, the sub labels on the visitor
// type cards (the wording below is OURS, not the design's), the fee pill
// wording, and the notice styling against the frames before relying on them.
//
// Decisions that are not in the frame (see CLAUDE.md):
//  - The lookup is by NAME, not phone: the portal exposes no phone number.
//  - One portal search per SUBMIT (the Look up button or Enter), never per
//    keystroke: the search bucket allows 20 a minute and the key stays on the
//    server. Only the Client type searches; every other type makes no portal
//    call at all.
//  - The result card's meta line and pills come only from the portal: kind,
//    estate and purchase label; the fee rollup status; and an open-cases pill
//    only when openCaseCount > 0. No phone, no client id shown.
//  - A non-client (any non-Client type, a lookup that finds nobody, or "none of
//    these") is logged with no clientId, and anything they raise is an
//    ENQUIRY, never a case.
import { useActionState, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/Avatar/Avatar";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { ChoiceGroup, type ChoiceOption } from "@/components/ChoiceGroup/ChoiceGroup";
import { Chip } from "@/components/Chip/Chip";
import { Notice } from "@/components/Notice/Notice";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { TextField } from "@/components/TextField/TextField";
import { ROLLUP_PILL } from "@/lib/feeRollup";
import { firstName } from "@/lib/format";
import type { ClientCandidate, Match } from "@/lib/portal";
import { IDLE_SEARCH, type VisitSearchState } from "@/lib/visitSearch";
import type { VisitorBriefState } from "@/lib/visitorBriefState";
import { loadVisitorBriefAction, searchVisitorAction } from "./actions";
import styles from "./NewVisitForm.module.css";

const VISITOR_TYPES = [
  { value: "client", label: "Client", sub: "Has a plot or unit" },
  { value: "realtor", label: "Realtor", sub: "Agent or partner" },
  { value: "investor", label: "Investor", sub: "Prospective buyer" },
  { value: "delivery", label: "Delivery", sub: "Courier or supplier" },
  { value: "visitor", label: "Visitor", sub: "Anyone else" },
] as const satisfies readonly ChoiceOption[];

type VisitorType = (typeof VISITOR_TYPES)[number]["value"];

const REASONS: ChoiceOption[] = [
  { value: "inquiry", label: "Inquiry" },
  { value: "complaint", label: "Complaint" },
  { value: "document-collection", label: "Document collection" },
  { value: "contract-signing", label: "Contract signing" },
  { value: "scheduled-meeting", label: "Scheduled meeting" },
];

// The candidate list's own last option: the visitor is not any of them.
const NOT_LISTED = "__not_listed__";

const MATCH_LABEL: Record<Match, string> = {
  MATCH_ONE_PARTY: "Exact name match",
  MATCH_ACROSS_PARTIES: "Matches across names on file",
  APPROXIMATE: "Approximate match",
};

type Person = { kind: "client"; clientId: string; name: string } | { kind: "non_client"; name: string };

function CandidateDetails({ candidate }: { candidate: ClientCandidate }) {
  return (
    <span className={styles.details}>
      <span className={styles.detailLine}>
        {MATCH_LABEL[candidate.match]} · {candidate.hasLogin ? "Has a portal login" : "No portal login yet"}
      </span>
      {candidate.parties.length > 1 ? (
        <span className={styles.detailLine}>On file as {candidate.parties.join(", ")}</span>
      ) : null}
      <span className={styles.detailLine}>{candidate.emailHint ?? "No email on file"}</span>
      {candidate.purchases.length > 0 ? (
        <span className={styles.purchases}>
          {candidate.purchases.map((purchase, index) => (
            <Chip key={`${purchase.label}-${index}`}>
              {purchase.label} · {purchase.estateName}
              {purchase.status === "CANCELLED" ? " · cancelled" : ""}
            </Chip>
          ))}
        </span>
      ) : (
        <span className={styles.detailLine}>No purchases</span>
      )}
    </span>
  );
}

export function NewVisitForm() {
  const [type, setType] = useState<VisitorType>("client");
  const [name, setName] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  // Which candidate the desk picked (a clientId), or NOT_LISTED.
  const [picked, setPicked] = useState<string | null>(null);
  const [brief, setBrief] = useState<VisitorBriefState | null>(null);
  // The name the current results were searched for, so results for an old name
  // are never shown beside a new one.
  const [searchedName, setSearchedName] = useState("");
  const latestPick = useRef<string | null>(null);
  const [briefLoading, startBrief] = useTransition();
  const [checkIn, setCheckIn] = useState<{ key: string; outcome: "not_wired" | "incomplete" } | null>(null);

  const [search, submitSearch, searching] = useActionState(
    async (previous: VisitSearchState, formData: FormData): Promise<VisitSearchState> => {
      latestPick.current = null;
      setPicked(null);
      setBrief(null);
      const typed = formData.get("name");
      setSearchedName(typeof typed === "string" ? typed.trim() : "");
      return searchVisitorAction(previous, formData);
    },
    IDLE_SEARCH,
  );

  const isClient = type === "client";
  const typedName = name.trim();
  const resultsVisible = isClient && search.kind !== "idle" && searchedName === typedName;

  function chooseType(value: string) {
    setType(value as VisitorType);
    latestPick.current = null;
    setPicked(null);
    setBrief(null);
  }

  function choosePerson(value: string) {
    setPicked(value);
    latestPick.current = value;
    setBrief(null);
    if (value === NOT_LISTED) return;
    startBrief(async () => {
      const result = await loadVisitorBriefAction(value);
      // A slower answer for an earlier pick must not overwrite a later one.
      if (latestPick.current === value) setBrief(result);
    });
  }

  // Who is being checked in, as far as the screen can tell.
  let person: Person | null = null;
  if (!isClient) {
    if (typedName) person = { kind: "non_client", name: typedName };
  } else if (resultsVisible) {
    if (search.kind === "no_match") person = { kind: "non_client", name: searchedName };
    if (search.kind === "candidates") {
      if (picked === NOT_LISTED) person = { kind: "non_client", name: searchedName };
      else {
        const candidate = search.candidates.find((entry) => entry.clientId === picked);
        if (candidate) person = { kind: "client", clientId: candidate.clientId, name: candidate.displayName };
      }
    }
  }

  const ready = person !== null && reason !== null;

  // What the last Check in press said. It belongs to the person and reason it
  // was pressed for, so it disappears as soon as either changes.
  const checkInKey = `${person ? `${person.kind}:${person.kind === "client" ? person.clientId : person.name}` : ""}|${reason ?? ""}`;

  return (
    <div className={styles.form}>
      <ChoiceGroup
        legend="Visitor type"
        name="visitor-type"
        variant="cards"
        options={[...VISITOR_TYPES]}
        value={type}
        onChange={chooseType}
      />

      <form
        className={styles.lookup}
        // Only the Client type searches. Anything else must never reach the
        // portal, not even by pressing Enter.
        action={isClient ? submitSearch : undefined}
        onSubmit={isClient ? undefined : (event) => event.preventDefault()}
      >
        <div className={styles.lookupRow}>
          <TextField
            className={styles.lookupField}
            label={isClient ? "Client name" : "Visitor's name"}
            name="name"
            value={name}
            onChange={setName}
            placeholder="Full name"
            describedBy="lookup-hint"
            enterKeyHint={isClient ? "search" : "done"}
          />
          {isClient ? (
            <Button type="submit" size="compact" disabled={searching} className={styles.lookupButton}>
              {searching ? "Looking up…" : "Look up"}
            </Button>
          ) : null}
        </div>
        <p id="lookup-hint" className={styles.hint}>
          {isClient
            ? "Searches the client records by name. Type at least two names, or one name of four or more letters."
            : "Type the name as they give it. Nothing is looked up."}
        </p>
      </form>

      {!isClient ? (
        <Notice tone="info" title="Not a client">
          No client lookup is made. This visit is logged with no client record, and anything they raise is an
          enquiry, never a complaint case.
        </Notice>
      ) : null}

      {/* The results region: announced politely, so a screen reader hears the outcome. */}
      <div className={styles.results} aria-live="polite">
        {resultsVisible && search.kind === "guidance" ? <Notice tone="guidance">{search.message}</Notice> : null}

        {resultsVisible && search.kind === "rate_limited" ? (
          <Notice tone="limited" title="Try again in a moment">
            {search.message}
          </Notice>
        ) : null}

        {resultsVisible && search.kind === "failure" ? (
          <Notice tone="failure" title="Something is wrong" role="alert">
            {search.message}
            {search.requestId ? ` Reference: ${search.requestId}.` : ""}
          </Notice>
        ) : null}

        {resultsVisible && search.kind === "no_match" ? (
          <Notice tone="info" title={`No client found for “${search.query}”`}>
            Check them in as a non-client: the visit is logged with no client record, and anything they raise is an
            enquiry, never a complaint case.
          </Notice>
        ) : null}

        {resultsVisible && search.kind === "candidates" ? (
          <div className={styles.candidates}>
            <ChoiceGroup
              legend="Who is this? Pick the right person"
              name="candidate"
              variant="rows"
              value={picked}
              onChange={choosePerson}
              options={[
                ...search.candidates.map((candidate) => ({
                  value: candidate.clientId,
                  label: candidate.displayName,
                  sub: <CandidateDetails candidate={candidate} />,
                })),
                {
                  value: NOT_LISTED,
                  label: "None of these",
                  sub: "Check in as a non-client. No client record, and anything they raise is an enquiry.",
                },
              ]}
            />
            {search.truncated ? (
              <Notice tone="guidance">
                There were more matches than are shown. If the person is not listed, add more of their name and look
                up again.
              </Notice>
            ) : null}
          </div>
        ) : null}
      </div>

      {person?.kind === "client" ? (
        <div className={styles.results} aria-live="polite">
          {briefLoading || brief === null ? (
            <Notice tone="info" role="status">
              Loading their record…
            </Notice>
          ) : brief.kind === "loaded" ? (
            <Card as="section" aria-labelledby="result-name" className={styles.result}>
              <Avatar name={brief.brief.displayName} size={40} />
              <div className={styles.resultText}>
                <h2 id="result-name" className={styles.resultName}>
                  {brief.brief.displayName}
                </h2>
                <p className={styles.resultMeta}>
                  {["Client", brief.brief.purchase?.estateName, brief.brief.purchase?.label]
                    .filter(Boolean)
                    .join(" · ")}
                  {brief.brief.morePurchases > 0 ? ` +${brief.brief.morePurchases} more` : ""}
                </p>
              </div>
              <div className={styles.resultPills}>
                <StatusPill tone={ROLLUP_PILL[brief.brief.feeStatus].tone}>{ROLLUP_PILL[brief.brief.feeStatus].label}</StatusPill>
                {brief.brief.openCaseCount !== null && brief.brief.openCaseCount > 0 ? (
                  <StatusPill tone="amber">
                    {brief.brief.openCaseCount} open {brief.brief.openCaseCount === 1 ? "case" : "cases"}
                  </StatusPill>
                ) : null}
              </div>
            </Card>
          ) : brief.kind === "rate_limited" ? (
            <Notice tone="limited" title="Try again in a moment" role="status">
              {brief.message} Their record could not be shown. Pick them again to retry.
            </Notice>
          ) : brief.kind === "not_found" ? (
            <Notice tone="failure" title="Record not found" role="alert">
              {brief.message}
            </Notice>
          ) : (
            <Notice tone="failure" title="Something is wrong" role="alert">
              {brief.message}
              {brief.requestId ? ` Reference: ${brief.requestId}.` : ""}
            </Notice>
          )}
        </div>
      ) : null}

      <ChoiceGroup
        legend="Reason for visit"
        name="reason"
        variant="chips"
        options={REASONS}
        value={reason}
        onChange={setReason}
      />

      {person?.kind === "non_client" && reason === "complaint" ? (
        <Notice tone="info" title="Logged as an enquiry">
          A non-client cannot have a complaint case. What they raise is recorded as an enquiry.
        </Notice>
      ) : null}

      {person?.kind === "non_client" && isClient ? (
        <Notice tone="info" title="Checking in as a non-client">
          Will be logged with no client record, as “{person.name}”.
        </Notice>
      ) : null}

      {/* TODO: checking in writes a visit to CSS's own store, which does not
          exist yet. Until it does, submitting only SAYS so: it records nothing,
          fakes no success, and goes nowhere. The button stays enabled on
          purpose (a disabled button reads as a bug, not as unbuilt). When the
          store exists, the visit must carry clientId only for a picked client
          and none for a non-client. */}
      <form
        className={styles.checkInForm}
        onSubmit={(event) => {
          event.preventDefault();
          setCheckIn({ key: checkInKey, outcome: ready ? "not_wired" : "incomplete" });
        }}
      >
        <Button type="submit" size="large" className={styles.checkIn}>
          {person ? `Check in ${firstName(person.name)} →` : "Check in →"}
        </Button>
        {checkIn?.key === checkInKey && checkIn.outcome === "not_wired" ? (
          <Notice tone="info" title="Check-in is not wired up yet" role="status">
            CSS has no visit store yet, so nothing was recorded. The client lookup above is live and reads the portal.
          </Notice>
        ) : null}
        {checkIn?.key === checkInKey && checkIn.outcome === "incomplete" ? (
          <Notice tone="guidance" role="status">
            Choose who is here and a reason for the visit first.
          </Notice>
        ) : null}
      </form>
    </div>
  );
}
