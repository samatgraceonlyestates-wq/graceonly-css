// Run with `npm test`. Synthetic portal responses and a stubbed fetch: no live
// calls, no real client data.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadVisitDetail } from "./visitDetail.ts";
import {
  GATE_OFF_MESSAGE,
  NOT_FOUND_MESSAGE,
  RATE_LIMITED_MESSAGE,
  type ReleasePosition,
  type VisitDetailState,
} from "./visitDetailState.ts";

const KEY = "test-id.test-secret-value";
const ID = "client-1";
const realFetch = globalThis.fetch;

type Route = "summary" | "documents" | "release";
type Responder = () => Response | Promise<Response>;

let urls: string[] = [];
let inFlight = 0;
let maxInFlight = 0;

function stub(routes: Record<Route, Responder>) {
  urls = [];
  inFlight = 0;
  maxInFlight = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    urls.push(url);
    const route: Route = url.endsWith("/release-check") ? "release" : url.endsWith("/documents") ? "documents" : "summary";
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5)); // let the other two start
      return await routes[route]();
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
}

const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });
const ok = (data: unknown) => json(200, { data, requestId: "req-1" });
const refusal = (status: number, code: string, headers?: Record<string, string>) =>
  json(status, { error: "Mr Marker Person said no", code, requestId: "req-9" }, headers);

const NA = { policy: "NO_FEE_APPLIES", status: "NOT_APPLICABLE", owedKobo: null, receivedKobo: 0, outstandingKobo: null, overpaidKobo: 0 };
const summaryBody = (clientId = ID) => ({
  clientId,
  displayName: "Test Person",
  parties: ["Test Person"],
  hasLogin: true,
  onFile: { since: "2026-01-02", origin: "PORTAL_SIGNUP" },
  emailHint: "t***@e****.com",
  purchases: [
    {
      purchaseId: "p-1",
      kind: "PLOT",
      label: "Plot T-1",
      estate: "TST",
      estateName: "Test Estate",
      status: "ACTIVE",
      documentationFee: NA,
      latestReceiptRef: null,
    },
  ],
  documentationFee: {
    status: "NO_FEE_ON_ANY_PURCHASE",
    needsAttention: false,
    feePurchaseCount: 0,
    noFeePurchaseCount: 1,
    unknownPurchaseCount: 0,
    outstandingPurchaseCount: 0,
    outstandingTotalKobo: null,
    outstandingTotalIsPartial: false,
  },
  openCaseCount: 0,
  receiptsActive: false,
});

const SLOTS = ["DEED_OF_ASSIGNMENT", "SURVEY_PLAN", "RECEIPT", "CONTRACT_OF_SALE", "ACKNOWLEDGMENT_LETTER", "CERTIFICATE_OF_OCCUPANCY"];
const documentsBody = (clientId = ID) => ({
  clientId,
  receiptsActive: false,
  purchases: [
    {
      purchaseId: "p-1",
      kind: "PLOT",
      label: "Plot T-1",
      estate: "TST",
      estateName: "Test Estate",
      status: "ACTIVE",
      documents: SLOTS.map((type) => ({ type, label: type, issued: false, count: 0, latestIssuedOn: null })),
    },
  ],
  unattached: [],
});

const answerBody = (clientId = ID) => ({
  clientId,
  portalGateEnabled: true,
  purchases: [
    {
      purchaseId: "p-1",
      kind: "PLOT",
      label: "Plot T-1",
      estate: "TST",
      estateName: "Test Estate",
      status: "ACTIVE",
      gatedDocumentsAllowed: false,
      byType: [
        { documentType: "DEED_OF_ASSIGNMENT", label: "Deed", typeIsGated: true, allowed: false, reason: "OUTSTANDING", outstandingKobo: 5000 },
      ],
    },
  ],
  summary: { livePurchaseCount: 1, gatedDocumentsAllowedCount: 0, gatedDocumentsRefusedCount: 1, endedPurchaseCount: 0, allLiveAllowed: false },
  evaluatedAt: "2026-10-20T10:00:00Z",
});

const gateOff = () => json(409, { error: "Gate off", code: "GATE_NOT_ACTIVE", requestId: "req-2" });

const healthy: Record<Route, Responder> = {
  summary: () => ok(summaryBody()),
  documents: () => ok(documentsBody()),
  release: gateOff,
};

function releaseOf(state: VisitDetailState): ReleasePosition {
  assert.equal(state.kind, "loaded");
  if (state.kind !== "loaded") throw new Error("not loaded");
  return state.release;
}

describe("loadVisitDetail", () => {
  beforeEach(() => {
    process.env.CSS_PORTAL_BASE_URL = "https://portal.test/api/css/v1";
    process.env.CSS_PORTAL_SERVICE_KEY = KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("loads the summary, documents and release position, fetched in parallel", async () => {
    stub({ ...healthy, release: () => ok(answerBody()) });
    const state = await loadVisitDetail(ID);
    assert.equal(state.kind, "loaded");
    if (state.kind !== "loaded") return;
    assert.equal(state.summary.displayName, "Test Person");
    assert.equal(state.documents.status, "ok");
    assert.equal(state.release.kind, "checked");
    assert.equal(urls.length, 3, "one call each: summary, documents, release-check");
    assert.equal(maxInFlight, 3, "all three were in flight together");
  });

  it("treats 409 GATE_NOT_ACTIVE as a normal state that is explicitly 'unknown, do not release'", async () => {
    stub(healthy);
    const state = await loadVisitDetail(ID);
    assert.equal(state.kind, "loaded", "not a failure");
    assert.deepEqual(releaseOf(state), {
      kind: "gate_off",
      handOver: "unknown_do_not_release",
      message: GATE_OFF_MESSAGE,
    });
    assert.match(GATE_OFF_MESSAGE, /not switched on/);
    assert.match(GATE_OFF_MESSAGE, /Do not release/);
  });

  it("passes a real answer through untouched, including allLiveAllowed false and the amounts", async () => {
    stub({ ...healthy, release: () => ok(answerBody()) });
    const release = releaseOf(await loadVisitDetail(ID));
    assert.ok(release.kind === "checked");
    if (release.kind !== "checked") return;
    assert.equal(release.answer.summary.allLiveAllowed, false);
    assert.equal(release.answer.purchases[0].byType[0].outstandingKobo, 5000);
  });

  it("answers an unknown or malformed id with not_found, whichever part says 404", async () => {
    stub({ summary: () => refusal(404, "NOT_FOUND"), documents: () => refusal(404, "NOT_FOUND"), release: () => refusal(404, "NOT_FOUND") });
    assert.deepEqual(await loadVisitDetail("nope"), { kind: "not_found", message: NOT_FOUND_MESSAGE });

    stub({ ...healthy, release: () => refusal(404, "NOT_FOUND") });
    assert.equal((await loadVisitDetail(ID)).kind, "not_found");
  });

  it("does not call the portal for an empty id", async () => {
    stub(healthy);
    assert.equal((await loadVisitDetail("   ")).kind, "not_found");
    assert.equal(urls.length, 0);
  });

  it("encodes the id so it cannot change the path", async () => {
    stub(healthy);
    await loadVisitDetail("a/b?x=1");
    assert.ok(urls.every((url) => url.includes("a%2Fb%3Fx%3D1")));
  });

  it("maps a 429 on the summary to rate_limited for the whole screen", async () => {
    stub({ ...healthy, summary: () => refusal(429, "RATE_LIMITED", { "retry-after": "60" }) });
    assert.deepEqual(await loadVisitDetail(ID), { kind: "rate_limited", message: RATE_LIMITED_MESSAGE, retryAfterSeconds: 60 });
  });

  const failures: [string, Responder, string][] = [
    ["401", () => refusal(401, "UNAUTHORIZED"), "unauthorized"],
    ["503", () => refusal(503, "API_DISABLED"), "unavailable"],
    [
      "a network failure",
      () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      },
      "network",
    ],
  ];
  for (const [name, respond, cause] of failures) {
    it(`maps ${name} on the summary to a failure (${cause}), distinct from rate limiting`, async () => {
      stub({ summary: respond, documents: respond, release: respond });
      const state = await loadVisitDetail(ID);
      assert.equal(state.kind, "failure");
      if (state.kind === "failure") assert.equal(state.cause, cause);
    });
  }

  it("keeps the screen when only the documents are rate limited", async () => {
    stub({ ...healthy, documents: () => refusal(429, "RATE_LIMITED", { "retry-after": "60" }) });
    const state = await loadVisitDetail(ID);
    assert.equal(state.kind, "loaded");
    if (state.kind !== "loaded") return;
    assert.equal(state.documents.status, "rate_limited");
    assert.equal(state.release.kind, "gate_off");
  });

  it("never turns an unfinished release check into an allow", async () => {
    const cases: [string, Responder][] = [
      ["429", () => refusal(429, "RATE_LIMITED", { "retry-after": "60" })],
      ["503 UNAVAILABLE", () => refusal(503, "UNAVAILABLE")],
      ["401", () => refusal(401, "UNAUTHORIZED")],
      ["another 409", () => json(409, { error: "x", code: "STALE", requestId: "r" })],
      ["a body of the wrong shape", () => ok({ nonsense: true })],
      [
        "a network failure",
        () => {
          throw new TypeError("fetch failed");
        },
      ],
    ];
    for (const [name, release] of cases) {
      stub({ ...healthy, release });
      const state = await loadVisitDetail(ID);
      assert.equal(state.kind, "loaded", `${name}: the rest of the screen still loads`);
      const position = releaseOf(state);
      assert.equal(position.kind, "unavailable", name);
      if (position.kind === "unavailable") assert.equal(position.handOver, "unknown_do_not_release", name);
    }
  });

  it("tells a rate-limited check apart from a failed one, both still 'do not release'", async () => {
    stub({ ...healthy, release: () => refusal(429, "RATE_LIMITED", { "retry-after": "60" }) });
    const limited = releaseOf(await loadVisitDetail(ID));
    assert.ok(limited.kind === "unavailable" && limited.cause === "rate_limited" && limited.retryAfterSeconds === 60);

    stub({ ...healthy, release: () => refusal(503, "UNAVAILABLE") });
    const broken = releaseOf(await loadVisitDetail(ID));
    assert.ok(broken.kind === "unavailable" && broken.cause === "unavailable");
  });

  it("refuses another client's data on this screen", async () => {
    stub({ ...healthy, documents: () => ok(documentsBody("someone-else")) });
    const state = await loadVisitDetail(ID);
    assert.ok(state.kind === "loaded" && state.documents.status === "failed");

    stub({ ...healthy, release: () => ok(answerBody("someone-else")) });
    const position = releaseOf(await loadVisitDetail(ID));
    assert.ok(position.kind === "unavailable" && position.handOver === "unknown_do_not_release");

    stub({ ...healthy, summary: () => ok(summaryBody("someone-else")) });
    assert.equal((await loadVisitDetail(ID)).kind, "failure");
  });

  it("keeps the portal's error text and the key out of every state", async () => {
    const seen: VisitDetailState[] = [];
    for (const routes of [
      { summary: () => refusal(401, "UNAUTHORIZED"), documents: () => refusal(401, "UNAUTHORIZED"), release: () => refusal(401, "UNAUTHORIZED") },
      { ...healthy, documents: () => refusal(503, "UNAVAILABLE"), release: () => refusal(503, "UNAVAILABLE") },
      { ...healthy, summary: () => json(401, { error: `bad key ${KEY}`, code: "UNAUTHORIZED", requestId: "r" }) },
    ]) {
      stub(routes);
      seen.push(await loadVisitDetail(ID));
    }
    const text = JSON.stringify(seen);
    assert.ok(!text.includes("Marker Person"), "portal error text must not reach the UI state");
    assert.ok(!text.includes("test-secret-value"), "the key must never appear");
  });

  it("does not write anything to the console", async () => {
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    let written = 0;
    console.log = console.info = console.warn = console.error = () => {
      written += 1;
    };
    try {
      stub(healthy);
      await loadVisitDetail(ID);
      stub({ ...healthy, summary: () => refusal(503, "UNAVAILABLE") });
      await loadVisitDetail(ID);
    } finally {
      Object.assign(console, original);
    }
    assert.equal(written, 0);
  });
});
