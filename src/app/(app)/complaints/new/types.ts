export type CaseSearchCandidate = {
  clientId: string;
  displayName: string;
  purchases: { purchaseId: string; label: string }[];
};

export type CaseSearchState =
  | { status: "idle" }
  | { status: "results"; candidates: CaseSearchCandidate[] }
  | { status: "error"; message: string };

export type CreateCaseState =
  | { status: "idle" }
  | { status: "error"; message: string };
