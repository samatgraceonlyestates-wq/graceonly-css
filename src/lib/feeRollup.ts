// How the documentation fee is worded and toned on screens 04 and 05. Pure and
// client-safe. The wording is OURS (the portal sends codes, not text). The fee
// is the ONLY money CSS may show: no balance, no price, no payment history.
import type { FeeStatus, RollupStatus } from "./portal.ts";

export type PillTone = "green" | "amber" | "red" | "neutral";

// The one fee pill, from the documentation fee rollup.
export const ROLLUP_PILL: Record<RollupStatus, { tone: PillTone; label: string }> = {
  HAS_OUTSTANDING: { tone: "red", label: "Fee outstanding" },
  HAS_UNKNOWN: { tone: "amber", label: "Fee status unknown" },
  ALL_PAID: { tone: "green", label: "Fee paid" },
  NO_FEE_ON_ANY_PURCHASE: { tone: "neutral", label: "No fee" },
  NO_LIVE_PURCHASES: { tone: "neutral", label: "No live purchases" },
};

// One purchase's fee position.
export const FEE_POSITION_PILL: Record<FeeStatus, { tone: PillTone; label: string }> = {
  NOT_APPLICABLE: { tone: "neutral", label: "No fee applies" },
  PAID: { tone: "green", label: "Paid" },
  OUTSTANDING: { tone: "red", label: "Outstanding" },
  UNKNOWN: { tone: "amber", label: "Not known" },
  INVALID: { tone: "amber", label: "Terms invalid" },
  ENDED: { tone: "neutral", label: "Ended" },
};
