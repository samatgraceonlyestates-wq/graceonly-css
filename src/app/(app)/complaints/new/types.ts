export type CaseSearchCandidate = {
  clientId: string;
  displayName: string;
  // Display only, from the client SEARCH endpoint. The search result carries no
  // purchaseId (ClientPurchaseBrief has none), so it must never be used to submit a
  // case. The real purchaseId comes from loadClientPurchasesAction (the summary).
  purchases: { label: string }[];
};

// A real purchase of a picked client, from GET /clients/{id} (the summary). Its
// purchaseId is the OPAQUE portal id the create-case endpoint resolves; that is the
// whole point of this type existing separately from the search brief above.
export type ClientPurchaseOption = {
  purchaseId: string;
  label: string;
  status: string;
};

export type LoadPurchasesResult =
  | { status: "ok"; purchases: ClientPurchaseOption[] }
  | { status: "error"; message: string };

export type CaseSearchState =
  | { status: "idle" }
  | { status: "results"; candidates: CaseSearchCandidate[] }
  | { status: "error"; message: string };

export type CreateCaseState =
  | { status: "idle" }
  | { status: "error"; message: string };
