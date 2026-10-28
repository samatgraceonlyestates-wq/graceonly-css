export type PickupSearchCandidate = {
  clientId: string;
  displayName: string;
  purchases: { purchaseId: string; label: string }[];
};

export type PickupSearchState =
  | { status: "idle" }
  | { status: "results"; candidates: PickupSearchCandidate[] }
  | { status: "error"; message: string };

export type RecordPickupState =
  | { status: "idle" }
  | { status: "error"; message: string };
