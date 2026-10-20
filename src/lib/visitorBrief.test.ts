// Run with `npm test`. Synthetic responses and a stubbed fetch: no live calls.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadVisitorBrief } from "./visitorBrief.ts";

const KEY = "test-id.test-secret-value";
const realFetch = globalThis.fetch;
let calls: string[] = [];

function stub(respond: () => Response) {
  calls = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input));
    return respond();
  }) as typeof fetch;
}

const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });

const NA = { policy: "NO_FEE_APPLIES", status: "NOT_APPLICABLE", owedKobo: null, receivedKobo: 0, outstandingKobo: null, overpaidKobo: 0 };
const purchase = (label: string) => ({
  purchaseId: label,
  kind: "PLOT",
  label,
  estate: "TST",
  estateName: "Test Estate",
  status: "ACTIVE",
  documentationFee: NA,
  latestReceiptRef: null,
});
const summary = (clientId: string, purchases: unknown[], openCaseCount: number | null) => ({
  data: {
    clientId,
    displayName: "Test Person",
    parties: ["Test Person"],
    hasLogin: true,
    onFile: { since: "2026-01-02", origin: "PORTAL_SIGNUP" },
    emailHint: null,
    purchases,
    documentationFee: {
      status: "NO_FEE_ON_ANY_PURCHASE",
      needsAttention: false,
      feePurchaseCount: 0,
      noFeePurchaseCount: purchases.length,
      unknownPurchaseCount: 0,
      outstandingPurchaseCount: 0,
      outstandingTotalKobo: null,
      outstandingTotalIsPartial: false,
    },
    openCaseCount,
    receiptsActive: false,
  },
  requestId: "req-1",
});

describe("loadVisitorBrief", () => {
  beforeEach(() => {
    process.env.CSS_PORTAL_BASE_URL = "https://portal.test/api/css/v1";
    process.env.CSS_PORTAL_SERVICE_KEY = KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns only what the result card needs, from one call", async () => {
    stub(() => json(200, summary("c1", [purchase("Plot T-1"), purchase("Plot T-2")], 2)));
    const state = await loadVisitorBrief("c1");
    assert.deepEqual(state, {
      kind: "loaded",
      brief: {
        clientId: "c1",
        displayName: "Test Person",
        purchase: { estateName: "Test Estate", label: "Plot T-1" },
        morePurchases: 1,
        feeStatus: "NO_FEE_ON_ANY_PURCHASE",
        openCaseCount: 2,
      },
    });
    assert.equal(calls.length, 1);
  });

  it("copes with no purchases and unknown open cases", async () => {
    stub(() => json(200, summary("c1", [], null)));
    const state = await loadVisitorBrief("c1");
    assert.ok(state.kind === "loaded" && state.brief.purchase === null && state.brief.openCaseCount === null);
  });

  it("maps 404, 429 and failures to distinct states", async () => {
    stub(() => json(404, { error: "x", code: "NOT_FOUND", requestId: "r" }));
    assert.equal((await loadVisitorBrief("c1")).kind, "not_found");

    stub(() => json(429, { error: "x", code: "RATE_LIMITED", requestId: "r" }, { "retry-after": "60" }));
    const limited = await loadVisitorBrief("c1");
    assert.ok(limited.kind === "rate_limited" && limited.retryAfterSeconds === 60);

    stub(() => json(503, { error: "Marker Person said no", code: "API_DISABLED", requestId: "r" }));
    const failed = await loadVisitorBrief("c1");
    assert.ok(failed.kind === "failure" && failed.cause === "unavailable");
    assert.ok(!JSON.stringify(failed).includes("Marker Person"));
  });

  it("refuses a summary for a different client", async () => {
    stub(() => json(200, summary("someone-else", [purchase("Plot T-1")], 0)));
    assert.equal((await loadVisitorBrief("c1")).kind, "failure");
  });

  it("makes no call for an empty id", async () => {
    stub(() => json(200, summary("c1", [], 0)));
    assert.equal((await loadVisitorBrief("  ")).kind, "not_found");
    assert.equal(calls.length, 0);
  });
});
