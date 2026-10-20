// The ONLY module in CSS that talks to the portal (CLAUDE.md rule 4): over its
// API, never its database, with the service key in X-Service-Key on every call.
//
// SERVER-ONLY. The guard below throws if this module is ever evaluated in a
// browser, and the key is read from a variable without the NEXT_PUBLIC_ prefix,
// so Next never inlines it into a client bundle. It is read per request, never
// held in module scope. No imports on purpose: the health script runs this
// file directly under Node's type stripping.
//
// The key is never logged, echoed or placed in an error. Any text that comes
// back from the portal or the network stack is scrubbed of it before it is
// returned.

if (typeof window !== "undefined") {
  throw new Error("src/lib/portal.ts is server-only and must never be imported into client code.");
}

export const PORTAL_ENV = {
  baseUrl: "CSS_PORTAL_BASE_URL",
  serviceKey: "CSS_PORTAL_SERVICE_KEY",
} as const;

const DEFAULT_TIMEOUT_MS = 10_000;

export type PortalErrorKind =
  | "config" // env missing or malformed; nothing was sent
  | "network" // could not reach the portal
  | "timeout"
  | "bad_request" // 400: the portal refused the query (code: QUERY_INVALID, QUERY_TOO_SHORT, TYPE_INVALID)
  | "unauthorized" // 401: key missing, unknown or wrong
  | "forbidden" // 403: key is valid but lacks the scope
  | "not_found" // 404
  | "conflict" // 409: e.g. a stale row version
  | "rate_limited" // 429
  | "unavailable" // 503
  | "unexpected"; // any other status, a redirect, or a body of the wrong shape

export interface PortalError {
  kind: PortalErrorKind;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  /** The portal's error code, for example SCOPE, QUERY_TOO_SHORT, UNAVAILABLE, API_DISABLED. */
  code: string | null;
  message: string;
  /** From the Retry-After header (whole seconds) on 429 and 503. */
  retryAfterSeconds: number | null;
  /** The portal's requestId for this call, when its body carried one. Quote it when reporting a problem. */
  requestId: string | null;
  /** The portal's error body, parsed if it was JSON. Scrubbed of the key. */
  body: unknown;
}

export type PortalResult<T> =
  | { ok: true; status: number; data: T; requestId: string | null }
  | { ok: false; error: PortalError };

export interface PortalGetOptions<T> {
  /** Turns the response body into T, or throws if it is not the shape expected. */
  parse: (raw: unknown) => T;
  /**
   * Statuses that are a legitimate OUTCOME rather than an error (for example
   * release-check's 409 GATE_NOT_ACTIVE). The handler returns T to accept the
   * response, or null to let it fall through to the normal error handling.
   */
  onStatus?: Readonly<Record<number, (body: unknown) => T | null>>;
  query?: Record<string, string>;
  timeoutMs?: number;
}

type Config = { baseUrl: string; serviceKey: string };

function failure(
  kind: PortalErrorKind,
  message: string,
  extra: Partial<Pick<PortalError, "status" | "code" | "retryAfterSeconds" | "requestId" | "body">> = {},
): { ok: false; error: PortalError } {
  return {
    ok: false,
    error: { kind, message, status: null, code: null, retryAfterSeconds: null, requestId: null, body: null, ...extra },
  };
}

// The error names the variable, never its value.
function readConfig(): { ok: true; config: Config } | { ok: false; error: PortalError } {
  const baseUrl = process.env[PORTAL_ENV.baseUrl]?.trim();
  const serviceKey = process.env[PORTAL_ENV.serviceKey]?.trim();

  if (!baseUrl) return failure("config", `${PORTAL_ENV.baseUrl} is not set.`);
  if (!serviceKey) return failure("config", `${PORTAL_ENV.serviceKey} is not set.`);

  // <id>.<secret>, printable ASCII only. This also stops a pasted newline from
  // reaching the header, where the runtime's own error could quote the value.
  if (!/^[\x21-\x7e]+$/.test(serviceKey) || !/^[^.]+\..+$/.test(serviceKey)) {
    return failure("config", `${PORTAL_ENV.serviceKey} is not in the form <id>.<secret>.`);
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return failure("config", `${PORTAL_ENV.baseUrl} is not a valid URL.`);
  }
  // The key must not travel in clear text, except to a local stand-in.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return failure("config", `${PORTAL_ENV.baseUrl} must be https.`);
  }

  return { ok: true, config: { baseUrl: baseUrl.replace(/\/+$/, ""), serviceKey } };
}

function scrub(text: string, serviceKey: string): string {
  const secret = serviceKey.slice(serviceKey.indexOf(".") + 1);
  return text.split(serviceKey).join("[redacted]").split(secret).join("[redacted]");
}

function scrubBody(body: unknown, serviceKey: string): unknown {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return scrub(body, serviceKey);
  return JSON.parse(scrub(JSON.stringify(body), serviceKey)) as unknown;
}

// JSON if it parses, else the raw text, else null for an empty body.
function readBody(text: string): unknown {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function retryAfter(headers: Headers): number | null {
  const value = headers.get("retry-after");
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

function kindForStatus(status: number): PortalErrorKind {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    case 503:
      return "unavailable";
    default:
      return "unexpected";
  }
}

const KIND_MESSAGE: Record<PortalErrorKind, string> = {
  config: "The portal client is not configured.",
  network: "Could not reach the portal.",
  timeout: "The portal did not answer in time.",
  bad_request: "The portal refused the request (400).",
  unauthorized: "The portal rejected the service key (401).",
  forbidden: "The service key does not have the scope for this call (403).",
  not_found: "The portal has no such resource (404).",
  conflict: "The portal reports a conflict (409).",
  rate_limited: "The portal is rate limiting this service (429).",
  unavailable: "The portal is unavailable (503).",
  unexpected: "The portal returned something unexpected.",
};

export async function portalGet<T>(path: string, options: PortalGetOptions<T>): Promise<PortalResult<T>> {
  const configured = readConfig();
  if (!configured.ok) return configured;
  const { baseUrl, serviceKey } = configured.config;

  if (!path.startsWith("/")) return failure("config", "Portal paths must start with /.");

  const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}${query}`, {
      method: "GET",
      headers: { "X-Service-Key": serviceKey, Accept: "application/json" },
      // Never follow a redirect: it would carry the key to wherever it points.
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return failure("timeout", KIND_MESSAGE.timeout);
    }
    // Only the system error code (ECONNREFUSED, ENOTFOUND ...), never the
    // runtime's message.
    const cause = error instanceof Error ? error.cause : undefined;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : null;
    return failure("network", code ? `${KIND_MESSAGE.network} (${code})` : KIND_MESSAGE.network);
  }

  let body: unknown;
  try {
    body = scrubBody(readBody(await response.text()), serviceKey);
  } catch {
    // The connection dropped or timed out mid-body.
    return failure("network", KIND_MESSAGE.network, { status: response.status });
  }

  const requestId = readRequestId(body);

  const outcome = options.onStatus?.[response.status];
  if (outcome) {
    const accepted = outcome(body);
    if (accepted !== null) return { ok: true, status: response.status, data: accepted, requestId };
  }

  if (response.status >= 200 && response.status < 300) {
    try {
      return { ok: true, status: response.status, data: options.parse(body), requestId };
    } catch (error) {
      // A ShapeError names the field, never its value.
      const detail = error instanceof ShapeError ? ` ${error.message}` : "";
      return failure("unexpected", `The portal's response was not the shape expected.${detail}`, {
        status: response.status,
        requestId,
        body,
      });
    }
  }

  const kind = kindForStatus(response.status);
  return failure(kind, kind === "unexpected" ? `${KIND_MESSAGE.unexpected} (${response.status}).` : KIND_MESSAGE[kind], {
    status: response.status,
    code: readCode(body),
    retryAfterSeconds: retryAfter(response.headers),
    requestId,
    body,
  });
}

// ---------------------------------------------------------------------------
// The portal's CSS API contract, typed from the portal's source (not from one
// live response).
//
//   success  { data: <payload>, requestId }
//   failure  { error, code, requestId }       (portalGet reads code and requestId)
//   codes    503 API_DISABLED · 401 UNAUTHORIZED · 403 SCOPE · 404 NOT_FOUND
//            429 RATE_LIMITED (retry-after 60) · 413 BODY_TOO_LARGE · 500 INTERNAL
//            400 QUERY_INVALID | QUERY_TOO_SHORT | TYPE_INVALID
//            409 GATE_NOT_ACTIVE · 503 UNAVAILABLE
//   limits   per key per minute: search 20; summary + documents share 60;
//            release-check 30. A 429 is a real outcome (kind "rate_limited",
//            retryAfterSeconds), not a crash: callers back off and show it.
//
// Fields are checked at runtime, so a response that drifts from the contract
// fails loudly with the field's path ("unexpected") and is never coerced. A
// value outside a closed vocabulary below is a drift, not something to guess.
// Extra fields are ignored. Money is integer KOBO. Dates are "YYYY-MM-DD"
// STRINGS formatted in SQL: never parse them as timestamps.
// ---------------------------------------------------------------------------

class ShapeError extends Error {}

type Parser<T> = (raw: unknown, path: string) => T;

function mismatch(path: string, expected: string): never {
  throw new ShapeError(`${path || "(body)"}: expected ${expected}.`);
}

const str: Parser<string> = (raw, path) => (typeof raw === "string" ? raw : mismatch(path, "a string"));
const bool: Parser<boolean> = (raw, path) => (typeof raw === "boolean" ? raw : mismatch(path, "a boolean"));
const int: Parser<number> = (raw, path) =>
  typeof raw === "number" && Number.isInteger(raw) ? raw : mismatch(path, "an integer");
const nonNegativeInt: Parser<number> = (raw, path) => {
  const value = int(raw, path);
  return value >= 0 ? value : mismatch(path, "an integer >= 0");
};
const positiveInt: Parser<number> = (raw, path) => {
  const value = int(raw, path);
  return value > 0 ? value : mismatch(path, "an integer > 0");
};

function literal<const V extends string | number | boolean | null>(expected: V): Parser<V> {
  return (raw, path) => (raw === expected ? expected : mismatch(path, `${JSON.stringify(expected)}`));
}

function oneOf<const V extends readonly string[]>(values: V): Parser<V[number]> {
  return (raw, path) =>
    typeof raw === "string" && (values as readonly string[]).includes(raw)
      ? (raw as V[number])
      : mismatch(path, `one of ${values.join(" | ")}`);
}

function nullable<T>(inner: Parser<T>): Parser<T | null> {
  return (raw, path) => (raw === null ? null : inner(raw, path));
}

function list<T>(inner: Parser<T>): Parser<T[]> {
  return (raw, path) =>
    Array.isArray(raw) ? raw.map((item: unknown, index) => inner(item, `${path}[${index}]`)) : mismatch(path, "an array");
}

function asRecord(raw: unknown, path: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return mismatch(path, "an object");
  return raw as Record<string, unknown>;
}

function object<S extends Record<string, Parser<unknown>>>(shape: S): Parser<{ [K in keyof S]: ReturnType<S[K]> }> {
  return (raw, path) => {
    const record = asRecord(raw, path);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) out[key] = shape[key](record[key], `${path}.${key}`);
    return out as { [K in keyof S]: ReturnType<S[K]> };
  };
}

// Every success body is { data, requestId }.
function enveloped<T>(inner: Parser<T>): (raw: unknown) => T {
  const envelope = object({ data: inner });
  return (raw) => envelope(raw, "").data;
}

function readRequestId(body: unknown): string | null {
  const value = typeof body === "object" && body !== null ? (body as { requestId?: unknown }).requestId : undefined;
  return typeof value === "string" ? value : null;
}

function readCode(body: unknown): string | null {
  const value = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined;
  return typeof value === "string" ? value : null;
}

// ----- Vocabularies (complete, from the portal's source) --------------------

export const PURCHASE_STATUSES = ["PENDING", "ACTIVE", "COMPLETED", "CANCELLED"] as const; // no "resold"
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_KINDS = ["PLOT", "UNIT", "PROPERTY"] as const;
export type PurchaseKind = (typeof PURCHASE_KINDS)[number];

export const FEE_POLICIES = ["NO_FEE_APPLIES", "FEE_APPLIES", "UNKNOWN"] as const;
export type FeePolicy = (typeof FEE_POLICIES)[number];

export const FEE_STATUSES = ["NOT_APPLICABLE", "PAID", "OUTSTANDING", "UNKNOWN", "INVALID", "ENDED"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export const ROLLUP_STATUSES = [
  "HAS_OUTSTANDING",
  "HAS_UNKNOWN",
  "ALL_PAID",
  "NO_FEE_ON_ANY_PURCHASE",
  "NO_LIVE_PURCHASES",
] as const;
export type RollupStatus = (typeof ROLLUP_STATUSES)[number];

export const MATCHES = ["MATCH_ONE_PARTY", "MATCH_ACROSS_PARTIES", "APPROXIMATE"] as const;
export type Match = (typeof MATCHES)[number];

export const RELEASE_REASONS = [
  "NO_FEE",
  "PAID",
  "OUTSTANDING",
  "UNKNOWN",
  "INVALID_TERMS",
  "ENDED",
  "UNAVAILABLE",
  "NOT_GATED_TYPE",
] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];
/** UNAVAILABLE cannot appear in a 200: any undecidable purchase makes the whole response a 503. */
export type ReleaseReasonInAnswer = Exclude<ReleaseReason, "UNAVAILABLE">;

// Exactly six slots, always all present, in this order. OTHER is NOT a slot: on
// a purchase it is a separate optional `other` key (see the documents section),
// and it is not a valid release-check documentType.
export const DOCUMENT_TYPES = [
  "DEED_OF_ASSIGNMENT",
  "SURVEY_PLAN",
  "RECEIPT",
  "CONTRACT_OF_SALE",
  "ACKNOWLEDGMENT_LETTER",
  "CERTIFICATE_OF_OCCUPANCY",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The seven types an UNATTACHED document can have: the six slots, then OTHER. */
export const UNATTACHED_DOCUMENT_TYPES = [...DOCUMENT_TYPES, "OTHER"] as const;
export type UnattachedDocumentType = (typeof UNATTACHED_DOCUMENT_TYPES)[number];

/** The portal's labels, for reference. The payload carries its own label on every entry. */
export const DOCUMENT_LABELS: Record<UnattachedDocumentType, string> = {
  DEED_OF_ASSIGNMENT: "Deed of Assignment",
  SURVEY_PLAN: "Provisional Survey Plan",
  RECEIPT: "Receipt of Payment",
  CONTRACT_OF_SALE: "Purchase Agreement",
  ACKNOWLEDGMENT_LETTER: "Initial Allocation Letter",
  CERTIFICATE_OF_OCCUPANCY: "C of O Copy",
  OTHER: "Other",
};

// Where a client's profile came from. Closed: exactly these two values.
//
//   IMPORTED       the profile came from the historical data migration.
//   PORTAL_SIGNUP  a normal signup-created profile.
//
// READ THIS BEFORE SHOWING EITHER FIELD AT A DESK:
//  - IMPORTED PERSISTS after the client claims the profile and signs in. So
//    `origin` does NOT say whether they have a login; `hasLogin` does. Never
//    infer "has not signed up" from IMPORTED.
//  - For IMPORTED, `since` is the day the RECORD WAS IMPORTED, NOT the day the
//    person became a client. Do not label it "client since". Say "on file since"
//    and, for IMPORTED, treat it as unknown as to when they actually bought.
export const ON_FILE_ORIGINS = ["IMPORTED", "PORTAL_SIGNUP"] as const;
export type OnFileOrigin = (typeof ON_FILE_ORIGINS)[number];

export interface OnFile {
  /** "YYYY-MM-DD", formatted in SQL. A string, never a timestamp. See the note above on what it means. */
  since: string;
  origin: OnFileOrigin;
}

const parseOnFile = object({ since: str, origin: oneOf(ON_FILE_ORIGINS) });

const purchaseStatus = oneOf(PURCHASE_STATUSES);
const purchaseKind = oneOf(PURCHASE_KINDS);
const feePolicy = oneOf(FEE_POLICIES);
const rollupStatus = oneOf(ROLLUP_STATUSES);
const documentType = oneOf(DOCUMENT_TYPES);

// ----- GET /health -----------------------------------------------------------

export interface PortalHealth {
  valid: boolean;
  scopes: string[];
  time: string;
}

const parseHealth = enveloped(object({ valid: bool, scopes: list(str), time: str }));

export function getHealth(): Promise<PortalResult<PortalHealth>> {
  return portalGet("/health", { parse: parseHealth });
}

// ----- Documentation fee: per purchase and rolled up --------------------------

// Per purchase. The field combinations are FIXED by status, so the type is a
// union on `status` and the parser rejects any other combination. Kobo.
export type PurchaseFee = { policy: FeePolicy } & (
  | {
      status: "NOT_APPLICABLE";
      owedKobo: null;
      receivedKobo: 0;
      outstandingKobo: null;
      overpaidKobo: 0;
      /** Money received on a purchase that owes no fee. Present only on NOT_APPLICABLE. */
      strayReceivedKobo?: number;
    }
  | { status: "PAID"; owedKobo: number; receivedKobo: number; outstandingKobo: 0; overpaidKobo: number }
  | { status: "OUTSTANDING"; owedKobo: number; receivedKobo: number; outstandingKobo: number; overpaidKobo: number }
  | { status: "UNKNOWN"; owedKobo: null; receivedKobo: 0; outstandingKobo: null; overpaidKobo: 0 }
  | { status: "INVALID"; owedKobo: null; receivedKobo: 0; outstandingKobo: null; overpaidKobo: 0 }
  | { status: "ENDED"; owedKobo: null; receivedKobo: null; outstandingKobo: null; overpaidKobo: null }
);

const parseNoMoney = object({
  owedKobo: literal(null),
  receivedKobo: literal(0),
  outstandingKobo: literal(null),
  overpaidKobo: literal(0),
});
const parsePaid = object({
  owedKobo: nonNegativeInt,
  receivedKobo: nonNegativeInt,
  outstandingKobo: literal(0),
  overpaidKobo: nonNegativeInt,
});
const parseOutstanding = object({
  owedKobo: nonNegativeInt,
  receivedKobo: nonNegativeInt,
  outstandingKobo: positiveInt,
  overpaidKobo: nonNegativeInt,
});
const parseEnded = object({
  owedKobo: literal(null),
  receivedKobo: literal(null),
  outstandingKobo: literal(null),
  overpaidKobo: literal(null),
});

// strayReceivedKobo exists only on NOT_APPLICABLE; anywhere else it is drift.
function noStray(record: Record<string, unknown>, path: string): Record<string, never> {
  return record.strayReceivedKobo === undefined ? {} : mismatch(`${path}.strayReceivedKobo`, "absent unless NOT_APPLICABLE");
}

const parsePurchaseFee: Parser<PurchaseFee> = (raw, path) => {
  const record = asRecord(raw, path);
  const policy = feePolicy(record.policy, `${path}.policy`);
  const status = oneOf(FEE_STATUSES)(record.status, `${path}.status`);
  switch (status) {
    case "NOT_APPLICABLE": {
      const stray = record.strayReceivedKobo;
      return {
        policy,
        status,
        ...parseNoMoney(raw, path),
        ...(stray === undefined ? {} : { strayReceivedKobo: nonNegativeInt(stray, `${path}.strayReceivedKobo`) }),
      };
    }
    case "PAID":
      return { policy, status, ...parsePaid(raw, path), ...noStray(record, path) };
    case "OUTSTANDING":
      return { policy, status, ...parseOutstanding(raw, path), ...noStray(record, path) };
    case "UNKNOWN":
    case "INVALID":
      return { policy, status, ...parseNoMoney(raw, path), ...noStray(record, path) };
    case "ENDED":
      return { policy, status, ...parseEnded(raw, path), ...noStray(record, path) };
  }
};

// Rolled up across a client's purchases. purchaseCount-style counts are LIVE
// purchases only. outstandingTotalKobo and outstandingTotalIsPartial follow the
// status, and the parser rejects any other combination.
export interface FeeRollupCounts {
  needsAttention: boolean;
  feePurchaseCount: number;
  noFeePurchaseCount: number;
  unknownPurchaseCount: number;
  outstandingPurchaseCount: number;
}

export type FeeRollup = FeeRollupCounts &
  (
    | { status: "NO_FEE_ON_ANY_PURCHASE" | "NO_LIVE_PURCHASES"; outstandingTotalKobo: null; outstandingTotalIsPartial: false }
    | { status: "ALL_PAID"; outstandingTotalKobo: 0; outstandingTotalIsPartial: false }
    | { status: "HAS_OUTSTANDING"; outstandingTotalKobo: number; outstandingTotalIsPartial: false }
    // The sum of the KNOWN outstanding amounts, or null when no live purchase bears a fee.
    | { status: "HAS_UNKNOWN"; outstandingTotalKobo: number | null; outstandingTotalIsPartial: true }
  );

const parseRollupCounts = object({
  needsAttention: bool,
  feePurchaseCount: nonNegativeInt,
  noFeePurchaseCount: nonNegativeInt,
  unknownPurchaseCount: nonNegativeInt,
  outstandingPurchaseCount: nonNegativeInt,
});

const parseFeeRollup: Parser<FeeRollup> = (raw, path) => {
  const record = asRecord(raw, path);
  const counts = parseRollupCounts(raw, path);
  const status = rollupStatus(record.status, `${path}.status`);
  const total = record.outstandingTotalKobo;
  const partial = record.outstandingTotalIsPartial;
  const at = (field: string) => `${path}.${field}`;
  switch (status) {
    case "NO_FEE_ON_ANY_PURCHASE":
    case "NO_LIVE_PURCHASES":
      return {
        ...counts,
        status,
        outstandingTotalKobo: literal(null)(total, at("outstandingTotalKobo")),
        outstandingTotalIsPartial: literal(false)(partial, at("outstandingTotalIsPartial")),
      };
    case "ALL_PAID":
      return {
        ...counts,
        status,
        outstandingTotalKobo: literal(0)(total, at("outstandingTotalKobo")),
        outstandingTotalIsPartial: literal(false)(partial, at("outstandingTotalIsPartial")),
      };
    case "HAS_OUTSTANDING":
      return {
        ...counts,
        status,
        outstandingTotalKobo: nonNegativeInt(total, at("outstandingTotalKobo")),
        outstandingTotalIsPartial: literal(false)(partial, at("outstandingTotalIsPartial")),
      };
    case "HAS_UNKNOWN":
      return {
        ...counts,
        status,
        outstandingTotalKobo: nullable(nonNegativeInt)(total, at("outstandingTotalKobo")),
        outstandingTotalIsPartial: literal(true)(partial, at("outstandingTotalIsPartial")),
      };
  }
};

// ----- GET /clients/search?q=  (name search; 20 per key per minute) ----------
//
// 400 QUERY_INVALID: missing, empty, over 100 characters, or no letters.
// 400 QUERY_TOO_SHORT: one word under 4 letters, or a single initial.
// Titles are ignored. At most 10 candidates, with a `truncated` flag and no
// paging: a truncated list means "narrow the name", not "fetch the next page".

export interface ClientPurchaseBrief {
  estate: string;
  estateName: string;
  label: string; // "Plot E-108"
  status: PurchaseStatus;
}

export interface ClientCandidate {
  clientId: string;
  displayName: string;
  parties: string[];
  /** null for one-party names and for MATCH_ACROSS_PARTIES. */
  matchedParty: string | null;
  match: Match;
  hasLogin: boolean;
  /** When and how the profile came to be: read the note on OnFileOrigin before showing it. */
  onFile: OnFile;
  /** Masked by the portal, for example "l***3@g****.com". */
  emailHint: string | null;
  /** Live first, then oldest first. May include cancelled ones. */
  purchases: ClientPurchaseBrief[];
  /** LIVE purchases only, so it can be less than purchases.length. */
  purchaseCount: number;
  documentationFee: { status: RollupStatus; needsAttention: boolean };
}

export interface ClientSearch {
  query: { words: string[]; truncated: boolean };
  candidates: ClientCandidate[];
}

const parseClientSearch = enveloped(
  object({
    query: object({ words: list(str), truncated: bool }),
    candidates: list(
      object({
        clientId: str,
        displayName: str,
        parties: list(str),
        matchedParty: nullable(str),
        match: oneOf(MATCHES),
        hasLogin: bool,
        onFile: parseOnFile,
        emailHint: nullable(str),
        purchases: list(object({ estate: str, estateName: str, label: str, status: purchaseStatus })),
        purchaseCount: nonNegativeInt,
        documentationFee: object({ status: rollupStatus, needsAttention: bool }),
      }),
    ),
  }),
);

export function searchClients(q: string): Promise<PortalResult<ClientSearch>> {
  return portalGet("/clients/search", { parse: parseClientSearch, query: { q } });
}

// ----- GET /clients/{id}  (summary; shares 60 per key per minute with documents)
//
// An unknown id, a malformed id and another client's purchaseId all give the
// SAME 404 with no detail: existence is not learnable, so do not try to tell
// them apart.

export type ClientPurchase = {
  purchaseId: string;
  kind: PurchaseKind;
  label: string;
  estate: string;
  estateName: string;
  status: PurchaseStatus;
  documentationFee: PurchaseFee;
  /** Always null: receipts are not live. Revisit this type when receiptsActive can be true. */
  latestReceiptRef: null;
};

export interface ClientSummary {
  clientId: string;
  displayName: string;
  parties: string[];
  hasLogin: boolean;
  onFile: OnFile;
  emailHint: string | null;
  /** Live first, then oldest first. */
  purchases: ClientPurchase[];
  documentationFee: FeeRollup;
  /** Excludes REALTOR_CONDUCT. null only if the case tables are absent. */
  openCaseCount: number | null;
  /** Always false today. */
  receiptsActive: false;
}

const parseClientSummary = enveloped(
  object({
    clientId: str,
    displayName: str,
    parties: list(str),
    hasLogin: bool,
    onFile: parseOnFile,
    emailHint: nullable(str),
    purchases: list(
      object({
        purchaseId: str,
        kind: purchaseKind,
        label: str,
        estate: str,
        estateName: str,
        status: purchaseStatus,
        documentationFee: parsePurchaseFee,
        latestReceiptRef: literal(null),
      }),
    ),
    documentationFee: parseFeeRollup,
    openCaseCount: nullable(nonNegativeInt),
    receiptsActive: literal(false),
  }),
);

export function getClientSummary(clientId: string): Promise<PortalResult<ClientSummary>> {
  return portalGet(`/clients/${encodeURIComponent(clientId)}`, { parse: parseClientSummary });
}

// ----- GET /clients/{id}/documents  (issued document types) -----------------
//
// Each purchase carries exactly six slots, always all present, in the order of
// DOCUMENT_TYPES (the parser enforces it). OTHER is not a slot: it sits on the
// purchase as a separate `other` key, beside `documents`, and is ABSENT
// entirely (not null) when the purchase has no OTHER document.

export interface ClientDocumentSlot {
  type: DocumentType;
  label: string;
  issued: boolean;
  count: number;
  /** "YYYY-MM-DD" (SQL-formatted string) or null when never issued. */
  latestIssuedOn: string | null;
}

/** Documents of type OTHER on one purchase. No type, label or issued field. */
export interface ClientOtherDocuments {
  /** At least 1. */
  count: number;
  /** "YYYY-MM-DD" (SQL-formatted string). Always present here. */
  latestIssuedOn: string;
}

export interface ClientDocumentsPurchase {
  purchaseId: string;
  kind: PurchaseKind;
  label: string;
  estate: string;
  estateName: string;
  status: PurchaseStatus;
  /** Exactly six, in DOCUMENT_TYPES order. */
  documents: ClientDocumentSlot[];
  /** Absent (not null) when the purchase has no OTHER document. */
  other?: ClientOtherDocuments;
}

/**
 * A document held for the client but attached to NO purchase (its purchaseId is
 * null: never set, or nulled when a purchase row went away). Only types that
 * exist appear, in UNATTACHED_DOCUMENT_TYPES order.
 *
 * NOT COVERED BY RELEASE-CHECK. The release gate works per purchase, so an
 * unattached document is outside it. A desk reading this list must NOT assume
 * these documents are gated, checked or cleared for release.
 */
export interface ClientUnattachedDocument {
  type: UnattachedDocumentType;
  label: string; // "Other" for OTHER
  count: number;
  /** "YYYY-MM-DD" (SQL-formatted string). */
  latestIssuedOn: string;
}

export interface ClientDocuments {
  clientId: string;
  /** Always false today. */
  receiptsActive: false;
  purchases: ClientDocumentsPurchase[];
  /** [] when there are none. Outside the release gate: see ClientUnattachedDocument. */
  unattached: ClientUnattachedDocument[];
}

const parseDocumentSlots: Parser<ClientDocumentSlot[]> = (raw, path) => {
  const slots = list(
    object({ type: documentType, label: str, issued: bool, count: nonNegativeInt, latestIssuedOn: nullable(str) }),
  )(raw, path);
  if (slots.length !== DOCUMENT_TYPES.length || slots.some((slot, index) => slot.type !== DOCUMENT_TYPES[index])) {
    return mismatch(path, `exactly the six document slots in order (${DOCUMENT_TYPES.join(", ")})`);
  }
  return slots;
};

const parseOtherDocuments = object({ count: positiveInt, latestIssuedOn: str });

const parseDocumentsPurchase: Parser<ClientDocumentsPurchase> = (raw, path) => {
  const base = object({
    purchaseId: str,
    kind: purchaseKind,
    label: str,
    estate: str,
    estateName: str,
    status: purchaseStatus,
    documents: parseDocumentSlots,
  })(raw, path);
  const other = asRecord(raw, path).other;
  // Absent, never null: a null here fails as "expected an object".
  return other === undefined ? base : { ...base, other: parseOtherDocuments(other, `${path}.other`) };
};

const parseUnattached: Parser<ClientUnattachedDocument[]> = (raw, path) => {
  const entries = list(
    object({
      type: oneOf(UNATTACHED_DOCUMENT_TYPES),
      label: str,
      count: positiveInt,
      latestIssuedOn: str,
    }),
  )(raw, path);
  // Each type at most once, in the portal's order.
  const order = entries.map((entry) => UNATTACHED_DOCUMENT_TYPES.indexOf(entry.type));
  if (order.some((position, index) => index > 0 && position <= order[index - 1])) {
    return mismatch(path, `each type once, in order (${UNATTACHED_DOCUMENT_TYPES.join(", ")})`);
  }
  return entries;
};

const parseClientDocuments = enveloped(
  object({
    clientId: str,
    receiptsActive: literal(false),
    purchases: list(parseDocumentsPurchase),
    unattached: parseUnattached,
  }),
);

export function getClientDocuments(clientId: string): Promise<PortalResult<ClientDocuments>> {
  return portalGet(`/clients/${encodeURIComponent(clientId)}/documents`, { parse: parseClientDocuments });
}

// ----- GET /clients/{id}/release-check  (30 per key per minute) --------------
//
// While DOC_GATE_ENABLED is off (production today) this answers 409
// GATE_NOT_ACTIVE. That is a legitimate OUTCOME, not an error: it comes back as
// ok with gate "not_active". It does not mean "allowed" and it does not mean
// "refused"; callers must handle it as its own state.
//
// Checked in this order: the gate flag (409), the client (404), documentType
// (400 TYPE_INVALID: only the six slots, OTHER is invalid), purchaseId (404).
// Any undecidable purchase makes the whole response a 503 UNAVAILABLE.
//
// TRAP 1: `gatedDocumentsAllowed` is computed from `byType`. If you filter by a
// NON-GATED type (RECEIPT or ACKNOWLEDGMENT_LETTER) there are no gated entries,
// so it is vacuously TRUE and the summary says everything is allowed. NEVER
// read that flag, or the summary's gated counts, from a filtered call.
//
// TRAP 2: `summary.allLiveAllowed` is FALSE when there are no live purchases.
// It is never true by emptiness. Do not "fix" that.

export interface ReleaseCheckByType {
  documentType: DocumentType;
  label: string;
  typeIsGated: boolean;
  allowed: boolean;
  reason: ReleaseReasonInAnswer;
  /** Kobo. Non-null only when reason is OUTSTANDING. */
  outstandingKobo: number | null;
}

export interface ReleaseCheckPurchase {
  purchaseId: string;
  kind: PurchaseKind;
  label: string;
  estate: string;
  estateName: string;
  status: PurchaseStatus;
  /** TRAP 1: derived from byType; vacuously true when a filter leaves no gated entries. */
  gatedDocumentsAllowed: boolean;
  byType: ReleaseCheckByType[];
}

export interface ReleaseCheckAnswer {
  clientId: string;
  portalGateEnabled: true;
  purchases: ReleaseCheckPurchase[];
  summary: {
    livePurchaseCount: number;
    gatedDocumentsAllowedCount: number;
    gatedDocumentsRefusedCount: number;
    endedPurchaseCount: number;
    /** TRAP 2: false when there are no live purchases. */
    allLiveAllowed: boolean;
  };
  /** ISO UTC, second precision. */
  evaluatedAt: string;
}

const RELEASE_REASONS_IN_ANSWER = RELEASE_REASONS.filter(
  (reason): reason is ReleaseReasonInAnswer => reason !== "UNAVAILABLE",
);

const parseReleaseCheckByType: Parser<ReleaseCheckByType> = (raw, path) => {
  const entry = object({
    documentType,
    label: str,
    typeIsGated: bool,
    allowed: bool,
    reason: oneOf(RELEASE_REASONS_IN_ANSWER),
    outstandingKobo: nullable(nonNegativeInt),
  })(raw, path);
  // Non-null only when the reason is OUTSTANDING.
  if ((entry.reason === "OUTSTANDING") !== (entry.outstandingKobo !== null)) {
    return mismatch(`${path}.outstandingKobo`, "non-null exactly when reason is OUTSTANDING");
  }
  return entry;
};

const parseReleaseCheckAnswer = enveloped(
  object({
    clientId: str,
    portalGateEnabled: literal(true),
    purchases: list(
      object({
        purchaseId: str,
        kind: purchaseKind,
        label: str,
        estate: str,
        estateName: str,
        status: purchaseStatus,
        gatedDocumentsAllowed: bool,
        byType: list(parseReleaseCheckByType),
      }),
    ),
    summary: object({
      livePurchaseCount: nonNegativeInt,
      gatedDocumentsAllowedCount: nonNegativeInt,
      gatedDocumentsRefusedCount: nonNegativeInt,
      endedPurchaseCount: nonNegativeInt,
      allLiveAllowed: bool,
    }),
    evaluatedAt: str,
  }),
);

export type ReleaseCheck =
  | { gate: "not_active"; code: "GATE_NOT_ACTIVE"; message: string }
  | { gate: "active"; answer: ReleaseCheckAnswer };

export interface ReleaseCheckFilter {
  /** One of the six slots. OTHER is invalid (400 TYPE_INVALID). See TRAP 1 before using this. */
  documentType?: DocumentType;
  purchaseId?: string;
}

const parseGateNotActive = object({ error: str, code: literal("GATE_NOT_ACTIVE") });

// The filter's query-parameter names (documentType, purchaseId) are taken from
// the contract's check order, not from a live call.
export function getReleaseCheck(
  clientId: string,
  filter: ReleaseCheckFilter = {},
): Promise<PortalResult<ReleaseCheck>> {
  const query: Record<string, string> = {};
  if (filter.documentType) query.documentType = filter.documentType;
  if (filter.purchaseId) query.purchaseId = filter.purchaseId;

  return portalGet(`/clients/${encodeURIComponent(clientId)}/release-check`, {
    query: Object.keys(query).length > 0 ? query : undefined,
    parse: (raw): ReleaseCheck => ({ gate: "active", answer: parseReleaseCheckAnswer(raw) }),
    onStatus: {
      409: (body): ReleaseCheck | null => {
        try {
          const parsed = parseGateNotActive(body, "");
          return { gate: "not_active", code: parsed.code, message: parsed.error };
        } catch {
          return null; // some other 409: a real conflict
        }
      },
    },
  });
}
