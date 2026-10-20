// Run with `npm test`. Synthetic portal responses and a stubbed fetch: no live
// calls, no real client data.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { lookupVisitor } from "./visitLookup.ts";
import { GUIDANCE_MESSAGE, RATE_LIMITED_MESSAGE, type VisitSearchOutcome } from "./visitSearch.ts";

const KEY = "test-id.test-secret-value";
const realFetch = globalThis.fetch;
let calls: string[] = [];

function stub(respond: () => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input));
    return respond();
  }) as typeof fetch;
}

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

const candidate = (name: string) => ({
  clientId: `id-${name}`,
  displayName: name,
  parties: [name],
  matchedParty: null,
  match: "MATCH_ONE_PARTY",
  hasLogin: true,
  onFile: { since: "2026-01-02", origin: "PORTAL_SIGNUP" },
  emailHint: "t***@e****.com",
  purchases: [{ estate: "TST", estateName: "Test Estate", label: "Plot T-1", status: "ACTIVE" }],
  purchaseCount: 1,
  documentationFee: { status: "NO_FEE_ON_ANY_PURCHASE", needsAttention: false },
});

const found = (names: string[], truncated = false) =>
  json(200, { data: { query: { words: ["TEST"], truncated }, candidates: names.map(candidate) }, requestId: "req-1" });

const refusal = (status: number, code: string, headers?: Record<string, string>) =>
  json(status, { error: "Mr Marker Person said no", code, requestId: "req-9" }, headers);

describe("lookupVisitor", () => {
  beforeEach(() => {
    process.env.CSS_PORTAL_BASE_URL = "https://portal.test/api/css/v1";
    process.env.CSS_PORTAL_SERVICE_KEY = KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns the portal's list untouched, never choosing", async () => {
    stub(() => found(["Ada Test", "Ada Tester"]));
    const outcome = await lookupVisitor("  Ada Test ");
    assert.equal(outcome.kind, "candidates");
    if (outcome.kind !== "candidates") return;
    assert.equal(outcome.query, "Ada Test");
    assert.deepEqual(outcome.candidates.map((c) => c.displayName), ["Ada Test", "Ada Tester"]);
    assert.equal(outcome.truncated, false);
    assert.equal(calls.length, 1, "one request per submit");
  });

  it("carries the truncated flag so the UI can say there were more", async () => {
    stub(() => found(["A Test"], true));
    const outcome = await lookupVisitor("Test");
    assert.ok(outcome.kind === "candidates" && outcome.truncated === true);
  });

  it("treats no candidates as a non-client, not an error", async () => {
    stub(() => found([]));
    assert.deepEqual(await lookupVisitor("Nobody Known"), { kind: "no_match", query: "Nobody Known" });
  });

  it("shows QUERY_TOO_SHORT as guidance", async () => {
    stub(() => refusal(400, "QUERY_TOO_SHORT"));
    assert.deepEqual(await lookupVisitor("Al"), {
      kind: "guidance",
      reason: "too_short",
      message: GUIDANCE_MESSAGE.too_short,
    });
  });

  it("shows QUERY_INVALID as guidance", async () => {
    stub(() => refusal(400, "QUERY_INVALID"));
    assert.deepEqual(await lookupVisitor("1234"), {
      kind: "guidance",
      reason: "invalid",
      message: GUIDANCE_MESSAGE.invalid,
    });
  });

  it("answers an empty submit with guidance and does not spend a search", async () => {
    stub(() => found([]));
    assert.deepEqual(await lookupVisitor("   "), { kind: "guidance", reason: "empty", message: GUIDANCE_MESSAGE.empty });
    assert.equal(calls.length, 0);
  });

  it("maps 429 to rate_limited with the retry hint, apart from failures", async () => {
    stub(() => refusal(429, "RATE_LIMITED", { "retry-after": "60" }));
    assert.deepEqual(await lookupVisitor("Ada Test"), {
      kind: "rate_limited",
      message: RATE_LIMITED_MESSAGE,
      retryAfterSeconds: 60,
    });
  });

  const failures: [string, () => Response | Promise<Response>, string][] = [
    ["401", () => refusal(401, "UNAUTHORIZED"), "unauthorized"],
    ["403 SCOPE", () => refusal(403, "SCOPE"), "forbidden"],
    ["503 API_DISABLED", () => refusal(503, "API_DISABLED"), "unavailable"],
    ["503 UNAVAILABLE", () => refusal(503, "UNAVAILABLE"), "unavailable"],
    ["500", () => refusal(500, "INTERNAL"), "unexpected"],
    [
      "network failure",
      () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      },
      "network",
    ],
    [
      "timeout",
      () => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      },
      "timeout",
    ],
    ["a 200 of the wrong shape", () => json(200, { data: { candidates: "nope" }, requestId: "r" }), "unexpected"],
  ];

  for (const [name, respond, cause] of failures) {
    it(`reports ${name} as a failure (${cause}), never as guidance, never as a retry`, async () => {
      stub(respond);
      const outcome = await lookupVisitor("Ada Test");
      assert.equal(outcome.kind, "failure");
      if (outcome.kind !== "failure") return;
      assert.equal(outcome.cause, cause);
      assert.ok(outcome.message.length > 0);
    });
  }

  it("reports missing configuration as a failure and sends nothing", async () => {
    stub(() => found([]));
    delete process.env.CSS_PORTAL_SERVICE_KEY;
    const outcome = await lookupVisitor("Ada Test");
    assert.ok(outcome.kind === "failure" && outcome.cause === "config");
    assert.equal(calls.length, 0);
  });

  it("keeps the portal's error text and the key out of every failure state", async () => {
    const seen: VisitSearchOutcome[] = [];
    for (const respond of [
      () => refusal(401, "UNAUTHORIZED"),
      () => refusal(503, "API_DISABLED"),
      () => refusal(429, "RATE_LIMITED", { "retry-after": "60" }),
      () => refusal(400, "QUERY_TOO_SHORT"),
      () => json(401, { error: `bad key ${KEY}`, code: "UNAUTHORIZED", requestId: "r" }),
    ]) {
      stub(respond);
      seen.push(await lookupVisitor("Ada Test"));
    }
    const text = JSON.stringify(seen);
    assert.ok(!text.includes("Marker Person"), "portal error text must not reach the UI state");
    assert.ok(!text.includes("test-secret-value"), "the key must never appear");
  });

  it("does not write the response to the console", async () => {
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    let written = 0;
    console.log = console.info = console.warn = console.error = () => {
      written += 1;
    };
    try {
      stub(() => found(["Ada Test"]));
      await lookupVisitor("Ada Test");
      stub(() => refusal(503, "UNAVAILABLE"));
      await lookupVisitor("Ada Test");
    } finally {
      Object.assign(console, original);
    }
    assert.equal(written, 0);
  });
});
