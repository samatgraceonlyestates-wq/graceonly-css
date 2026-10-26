"use client";

// UNVERIFIED AGAINST FIGMA. Screen 04 (nodes 27:2 / 27:59) was built from a
// written description of the frames, not from the frames themselves: the Figma
// MCP quota was spent. Check spacing, type sizes, the sub labels on the visitor
// type cards (the wording below is OURS, not the design's), the fee pill
// wording, and the notice styling against the frames before relying on them.
// The non-client details (phone, organisation, consent) and "who they came to
// see" are NOT in the frame description at all: built from shared components.
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
//  - CHECK IN WRITES THE VISIT (visits.ts). Who is being checked in, and what the
//    lookup came to, is decided by personFor (visitForm.ts): a client picked from the
//    list is MATCHED; nobody found is NO_MATCH; a search that FAILED lets her check
//    them in anyway, as PORTAL_UNAVAILABLE, and the screen says it will not be
//    verified. Check-in itself never calls the portal, so it works when it is down.
//  - A non-client needs CONSENT (a tick) before anything about them is recorded; their
//    phone is optional and normalised to +234... A number already on file asks "is this
//    <name>?" first, and nothing is written until she answers.
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
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
import { IDLE_CHECK_IN, NOT_LISTED, personFor, type CheckInState } from "@/lib/visitForm";
import { MESSAGES, VISIT_LIMITS, VISIT_REASONS, type VisitorTypeCode } from "@/lib/visits";
import { IDLE_SEARCH, type VisitSearchState } from "@/lib/visitSearch";
import type { VisitorBriefState } from "@/lib/visitorBriefState";
import { checkInAction, loadVisitorBriefAction, searchVisitorAction } from "./actions";
import styles from "./NewVisitForm.module.css";

const VISITOR_TYPES = [
  { value: "CLIENT", label: "Client", sub: "Has a plot or unit" },
  { value: "REALTOR", label: "Realtor", sub: "Agent or partner" },
  { value: "INVESTOR", label: "Investor", sub: "Prospective buyer" },
  { value: "DELIVERY", label: "Delivery", sub: "Courier or supplier" },
  { value: "VISITOR", label: "Visitor", sub: "Anyone else" },
] as const satisfies readonly (ChoiceOption & { value: VisitorTypeCode })[];

const REASONS: ChoiceOption[] = VISIT_REASONS.map((reason) => ({ value: reason.code, label: reason.label }));

const MATCH_LABEL: Record<Match, string> = {
  MATCH_ONE_PARTY: "Exact name match",
  MATCH_ACROSS_PARTIES: "Matches across names on file",
  APPROXIMATE: "Approximate match",
};

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
  const [type, setType] = useState<VisitorTypeCode>("CLIENT");
  const [name, setName] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [toSee, setToSee] = useState("");
  const [phone, setPhone] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [consent, setConsent] = useState(false);
  // Which candidate the desk picked (a clientId), or NOT_LISTED.
  const [picked, setPicked] = useState<string | null>(null);
  const [brief, setBrief] = useState<VisitorBriefState | null>(null);
  // The name the current results were searched for, so results for an old name
  // are never shown beside a new one.
  const [searchedName, setSearchedName] = useState("");
  const latestPick = useRef<string | null>(null);
  const [briefLoading, startBrief] = useTransition();

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

  const isClient = type === "CLIENT";
  const typedName = name.trim();
  const resultsVisible = isClient && search.kind !== "idle" && searchedName === typedName;

  function chooseType(value: string) {
    setType(value as VisitorTypeCode);
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

  // Who is being checked in, and what the lookup came to.
  const person = personFor({ isClient, typedName, search, searchedName, picked });
  const ready = person !== null && reason !== null;

  // ---- check in
  // What the last press said belongs to what it was pressed for: change any of it and the
  // message goes, so an old refusal or question never sits beside a new person.
  const checkInKey = JSON.stringify([type, person, reason, phone.trim(), organisation.trim(), toSee.trim(), consent]);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<{ key: string; message: string } | null>(null);
  const [sameVisitorId, setSameVisitorId] = useState("");
  const [declined, setDeclined] = useState<string | null>(null);
  const [resubmit, setResubmit] = useState(0);
  const checkInForm = useRef<HTMLFormElement | null>(null);
  const [checkIn, submitCheckIn, checkingIn] = useActionState(async (previous: CheckInState, formData: FormData): Promise<CheckInState> => {
    setSubmittedKey(String(formData.get("key")));
    setDeclined(null);
    return checkInAction(previous, formData);
  }, IDLE_CHECK_IN);
  const answer = submittedKey === checkInKey ? checkIn : IDLE_CHECK_IN;

  // "Yes, it is them": the same form goes again, now naming the visitor she confirmed.
  useEffect(() => {
    if (resubmit > 0) checkInForm.current?.requestSubmit();
  }, [resubmit]);

  function sameVisitor(id: string) {
    setSameVisitorId(id);
    setResubmit((count) => count + 1);
  }

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
            maxLength={VISIT_LIMITS.maxNameLength}
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
          <Notice tone="limited" title="The portal is too busy to answer">
            {search.message} Or check them in now without it: the visit will be marked as not verified.
          </Notice>
        ) : null}

        {resultsVisible && search.kind === "failure" ? (
          <Notice tone="failure" title="The portal could not be reached" role="alert">
            {search.message}
            {search.requestId ? ` Reference: ${search.requestId}.` : ""} You can still check them in: the visit will be
            marked as NOT VERIFIED, because nobody could check them against the client records.
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
              {brief.message} Their record could not be shown. Pick them again to retry. Checking them in does not
              need it.
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

      {/* Anyone who is not a picked client gets a visitor record: their details, with consent. */}
      {person?.kind === "visitor" ? (
        <section className={styles.visitorDetails} aria-labelledby="visitor-details-heading">
          <h2 id="visitor-details-heading" className={styles.detailsHeading}>
            {person.lookup === "PORTAL_UNAVAILABLE"
              ? `Checking in ${person.name} without the portal (not verified)`
              : person.lookup === "NO_MATCH"
                ? `Checking in ${person.name} as a non-client`
                : "Their details"}
          </h2>
          <div className={styles.detailsRow}>
            <div className={styles.detailsField}>
              <TextField
                label="Phone (optional)"
                name="phone-entry"
                value={phone}
                onChange={setPhone}
                placeholder="0803 123 4567"
                inputMode="tel"
                autoCapitalize="off"
                autoComplete="off"
                maxLength={40}
                describedBy="phone-hint"
              />
              <p id="phone-hint" className={styles.hint}>
                A number they have given before finds their earlier visits. It is saved as +234…
              </p>
            </div>
            <TextField
              className={styles.detailsField}
              label="Organisation (optional)"
              name="organisation-entry"
              value={organisation}
              onChange={setOrganisation}
              placeholder="Company or firm"
              maxLength={VISIT_LIMITS.maxOrganisationLength}
            />
          </div>
          <label className={styles.consent}>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>
              They agree to their name{phone.trim() !== "" ? " and number" : ""} being recorded in the visitor log.
              <span className={styles.consentNote}> Required. Without it, write them in the paper book instead.</span>
            </span>
          </label>
        </section>
      ) : null}

      <ChoiceGroup
        legend="Reason for visit"
        name="reason"
        variant="chips"
        options={REASONS}
        value={reason}
        onChange={setReason}
      />

      <TextField
        label="Here to see (optional)"
        name="to-see-entry"
        value={toSee}
        onChange={setToSee}
        placeholder="Who they came to see"
        maxLength={VISIT_LIMITS.maxToSeeLength}
      />

      {person?.kind === "visitor" && reason === "COMPLAINT" ? (
        <Notice tone="info" title="Logged as an enquiry">
          A non-client cannot have a complaint case. What they raise is recorded as an enquiry.
        </Notice>
      ) : null}

      <form
        ref={checkInForm}
        className={styles.checkInForm}
        action={submitCheckIn}
        onSubmit={(event) => {
          // What the screen already knows is missing is said here; everything else the server decides.
          if (ready) return;
          event.preventDefault();
          const message =
            reason === null && person !== null
              ? MESSAGES.reason
              : isClient && typedName !== ""
                ? MESSAGES.lookupFirst
                : isClient
                  ? "Type the client's name and look them up."
                  : MESSAGES.name;
          setIncomplete({ key: checkInKey, message });
        }}
      >
        <input type="hidden" name="key" value={checkInKey} />
        <input type="hidden" name="visitorType" value={type} />
        <input type="hidden" name="reason" value={reason ?? ""} />
        <input type="hidden" name="toSee" value={toSee} />
        <input type="hidden" name="lookup" value={person?.lookup ?? ""} />
        <input type="hidden" name="clientId" value={person?.kind === "client" ? person.clientId : ""} />
        <input type="hidden" name="clientName" value={person?.kind === "client" ? person.name : ""} />
        <input type="hidden" name="name" value={person?.kind === "visitor" ? person.name : ""} />
        <input type="hidden" name="phone" value={person?.kind === "visitor" ? phone : ""} />
        <input type="hidden" name="organisation" value={person?.kind === "visitor" ? organisation : ""} />
        <input type="hidden" name="consent" value={person?.kind === "visitor" && consent ? "yes" : ""} />
        <input type="hidden" name="sameVisitorId" value={sameVisitorId} />

        <Button type="submit" size="large" className={styles.checkIn} disabled={checkingIn}>
          {checkingIn ? "Checking in…" : person ? `Check in ${firstName(person.name)} →` : "Check in →"}
        </Button>

        {incomplete?.key === checkInKey ? (
          <Notice tone="guidance" role="status">
            {incomplete.message}
          </Notice>
        ) : null}

        {answer.status === "error" ? (
          <Notice tone="failure" title="Not checked in" role="alert">
            {answer.message}
          </Notice>
        ) : null}

        {answer.status === "confirm" && declined !== answer.visitor.id ? (
          <Notice tone="info" title="Have they been here before?" role="status">
            <p>{answer.message}</p>
            <p>If it is them, the visit is added to their record under the name on file, {answer.visitor.name}.</p>
            <div className={styles.confirmActions}>
              <Button size="compact" disabled={checkingIn} onClick={() => sameVisitor(answer.visitor.id)}>
                Yes, it is {answer.visitor.name}
              </Button>
              <Button variant="row-action" onClick={() => setDeclined(answer.visitor.id)}>
                No, a different person
              </Button>
            </div>
          </Notice>
        ) : null}

        {answer.status === "confirm" && declined === answer.visitor.id ? (
          <Notice tone="guidance" role="status">
            Then that number cannot be theirs as well: one number is one person here. Check it with them, or leave the
            phone empty.
          </Notice>
        ) : null}
      </form>
    </div>
  );
}
