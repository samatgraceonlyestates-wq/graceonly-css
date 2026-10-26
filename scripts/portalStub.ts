// A STAND-IN for the portal's CSS API, for the screenshot scenarios (shots-visits.ts,
// shots-handovers.ts). NEVER the real portal: it listens on 127.0.0.1 and answers search,
// summary, documents and release-check with two made-up clients, in the shapes portal.ts parses.
// The scenario switches it: `down` (503 on everything) and `release` (the gate OFF, as it is
// today; ON and ALLOWING; ON and BLOCKING the Deed of Assignment). It lives in the screenshot
// runner's process and ends with it.
import { createServer } from "node:http";

export const CHIDINMA = "5e6f7a8b-0000-4000-8000-00000000c1d1";
export const KINGSLEY = "a1b2c3d4-0000-4000-8000-00000000e2e0";
const KEY = "stub-id.stub-secret";

export type ReleaseMode = "off" | "allow" | "block";

export interface PortalStub {
  down: boolean;
  release: ReleaseMode;
  searches: number;
  releaseChecks: number;
  /** False once any call arrived without the service key. */
  keyHeaderSeen: boolean;
  close(): void;
}

const CLIENTS: Record<string, { name: string; estate: string; plot: string }> = {
  [CHIDINMA]: { name: "Chidinma Okafor", estate: "GraceWaters", plot: "Plot E-108" },
  [KINGSLEY]: { name: "Kingsley Eze", estate: "GracePool", plot: "Plot B-12" },
};
export const purchaseIdOf = (clientId: string) => `p-${clientId.slice(0, 4)}`;

const NA = { policy: "NO_FEE_APPLIES", status: "NOT_APPLICABLE", owedKobo: null, receivedKobo: 0, outstandingKobo: null, overpaidKobo: 0 };
const ROLLUP = {
  status: "NO_FEE_ON_ANY_PURCHASE",
  needsAttention: false,
  feePurchaseCount: 0,
  noFeePurchaseCount: 1,
  unknownPurchaseCount: 0,
  outstandingPurchaseCount: 0,
  outstandingTotalKobo: null,
  outstandingTotalIsPartial: false,
};
const SLOTS = ["DEED_OF_ASSIGNMENT", "SURVEY_PLAN", "RECEIPT", "CONTRACT_OF_SALE", "ACKNOWLEDGMENT_LETTER", "CERTIFICATE_OF_OCCUPANCY"];
const LABELS: Record<string, string> = {
  DEED_OF_ASSIGNMENT: "Deed of Assignment",
  SURVEY_PLAN: "Provisional Survey Plan",
  RECEIPT: "Receipt of Payment",
  CONTRACT_OF_SALE: "Purchase Agreement",
  ACKNOWLEDGMENT_LETTER: "Initial Allocation Letter",
  CERTIFICATE_OF_OCCUPANCY: "C of O Copy",
};
const NOT_GATED = new Set(["RECEIPT", "ACKNOWLEDGMENT_LETTER"]);
// Issued so far: the desk can see what EXISTS before handing anything over.
const ISSUED: Record<string, { count: number; on: string }> = { DEED_OF_ASSIGNMENT: { count: 1, on: "2026-09-14" }, RECEIPT: { count: 2, on: "2026-08-02" } };

function answer(stub: PortalStub, url: URL): { status: number; body: unknown } {
  const ok = (data: unknown) => ({ status: 200, body: { data, requestId: "stub-ok" } });
  const purchase = (id: string) => ({ purchaseId: purchaseIdOf(id), kind: "PLOT", estate: "GW", estateName: CLIENTS[id]!.estate, label: CLIENTS[id]!.plot, status: "ACTIVE" });

  if (url.pathname.endsWith("/clients/search")) {
    stub.searches += 1;
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const found = Object.entries(CLIENTS).filter(([, client]) => q.split(/\s+/).every((word) => client.name.toLowerCase().includes(word)));
    return ok({
      query: { words: q.toUpperCase().split(/\s+/), truncated: false },
      candidates: found.map(([id, client]) => ({
        clientId: id,
        displayName: client.name,
        parties: [client.name],
        matchedParty: null,
        match: "MATCH_ONE_PARTY",
        hasLogin: true,
        onFile: { since: "2025-03-01", origin: "PORTAL_SIGNUP" },
        emailHint: "c***@e****.com",
        purchases: [{ estate: "GW", estateName: client.estate, label: client.plot, status: "ACTIVE" }],
        purchaseCount: 1,
        documentationFee: { status: "NO_FEE_ON_ANY_PURCHASE", needsAttention: false },
      })),
    });
  }

  const match = /\/clients\/([^/]+)(\/documents|\/release-check)?$/.exec(url.pathname);
  const id = match ? decodeURIComponent(match[1]!) : "";
  if (!CLIENTS[id]) return { status: 404, body: { error: "Not found", code: "NOT_FOUND", requestId: "stub-404" } };

  if (match![2] === "/release-check") {
    stub.releaseChecks += 1;
    if (stub.release === "off") return { status: 409, body: { error: "The document gate is not active.", code: "GATE_NOT_ACTIVE", requestId: "stub-gate-off" } };
    const blockDeed = stub.release === "block";
    const byType = SLOTS.map((type) => {
      const gated = !NOT_GATED.has(type);
      const refused = blockDeed && type === "DEED_OF_ASSIGNMENT";
      return {
        documentType: type,
        label: LABELS[type],
        typeIsGated: gated,
        allowed: !refused,
        reason: !gated ? "NOT_GATED_TYPE" : refused ? "OUTSTANDING" : "PAID",
        outstandingKobo: refused ? 25_000_00 : null,
      };
    });
    return {
      status: 200,
      body: {
        requestId: `stub-gate-${stub.release}`,
        data: {
          clientId: id,
          portalGateEnabled: true,
          purchases: [{ ...purchase(id), gatedDocumentsAllowed: !blockDeed, byType }],
          summary: {
            livePurchaseCount: 1,
            gatedDocumentsAllowedCount: blockDeed ? 3 : 4,
            gatedDocumentsRefusedCount: blockDeed ? 1 : 0,
            endedPurchaseCount: 0,
            allLiveAllowed: !blockDeed,
          },
          evaluatedAt: new Date().toISOString().slice(0, 19) + "Z",
        },
      },
    };
  }

  if (match![2] === "/documents") {
    return ok({
      clientId: id,
      receiptsActive: false,
      purchases: [
        {
          ...purchase(id),
          documents: SLOTS.map((type) => ({
            type,
            label: LABELS[type],
            issued: ISSUED[type] !== undefined,
            count: ISSUED[type]?.count ?? 0,
            latestIssuedOn: ISSUED[type]?.on ?? null,
          })),
        },
      ],
      unattached: [],
    });
  }

  return ok({
    clientId: id,
    displayName: CLIENTS[id]!.name,
    parties: [CLIENTS[id]!.name],
    hasLogin: true,
    onFile: { since: "2025-03-01", origin: "PORTAL_SIGNUP" },
    emailHint: "c***@e****.com",
    purchases: [{ ...purchase(id), documentationFee: NA, latestReceiptRef: null }],
    documentationFee: ROLLUP,
    openCaseCount: 0,
    receiptsActive: false,
  });
}

/** Starts it on 127.0.0.1:`port`. Returns it and the environment that points the app at it. */
export async function startPortalStub(port: number): Promise<{ stub: PortalStub; env: Record<string, string> }> {
  const stub: PortalStub = { down: false, release: "off", searches: 0, releaseChecks: 0, keyHeaderSeen: true, close: () => {} };
  const server = createServer((request, response) => {
    if (request.headers["x-service-key"] !== KEY) stub.keyHeaderSeen = false;
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const { status, body } = stub.down ? { status: 503, body: { error: "Unavailable", code: "UNAVAILABLE", requestId: "stub-down" } } : answer(stub, url);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  server.unref(); // it must never keep the run alive
  stub.close = () => server.close();
  return { stub, env: { CSS_PORTAL_BASE_URL: `http://127.0.0.1:${port}/api/css/v1`, CSS_PORTAL_SERVICE_KEY: KEY } };
}
