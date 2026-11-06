// The ONLY module in CSS that talks to the STAFF PORTAL (a DIFFERENT system from
// the client portal in portal.ts): over its team:* API, with the service key in
// X-Service-Key on every call. It is used by the "Assign to staff" action to list
// colleagues and to create a task for one.
//
// SERVER-ONLY. The guard below throws if this module is ever evaluated in a
// browser, and the key is read from a variable without the NEXT_PUBLIC_ prefix,
// so Next never inlines it into a client bundle. It is read per request, never
// held in module scope.
//
// Its OWN environment, never the client portal's:
//   STAFF_PORTAL_BASE_URL   the staff portal's ORIGIN, no trailing slash and NO
//                           path (http://localhost:3002 in dev). This module adds
//                           the /api/team/v1/... path itself, and resolves a task's
//                           linkPath against this origin for the "view task" link.
//   TEAM_SERVICE_KEY        the shared secret for X-Service-Key. NOT
//                           CSS_PORTAL_SERVICE_KEY. Surrounding quotes are stripped
//                           (the cPanel launcher can leave them on an env value).
//
// This file mirrors portal.ts's transport hardening (redirect:manual, no-store, a
// 10s timeout, HTTPS except a localhost stand-in, a PortalResult union, typed
// parsers that reject drift) and its secrecy rules: the key is never logged,
// echoed or placed in an error, and any text that comes back is scrubbed of it.
//
// The staff portal's contract (from the live portal, pasted into the session):
//   GET  /api/team/v1/staff  -> 200 { staff: [ {id, full_name, email, department|null, role} ] }
//   POST /api/team/v1/tasks  -> 201 (new) or 200 (replay) { ok:true, taskId, linkPath, replayed }
//   errors (both)            -> non-2xx { error: string }. NO ok:false, NO code,
//                              NO requestId: success is decided by HTTP status.

if (typeof window !== "undefined") {
  throw new Error("src/lib/staffPortal.ts is server-only and must never be imported into client code.");
}

export const STAFF_PORTAL_ENV = {
  baseUrl: "STAFF_PORTAL_BASE_URL",
  serviceKey: "TEAM_SERVICE_KEY",
} as const;

const DEFAULT_TIMEOUT_MS = 10_000;

export type StaffPortalErrorKind =
  | "config"
  | "network"
  | "timeout"
  | "bad_request" // 400 / 422: the portal refused the input
  | "unauthorized" // 401: key missing, unknown or wrong
  | "forbidden" // 403
  | "not_found" // 404
  | "conflict" // 409
  | "rate_limited" // 429
  | "unavailable" // 503
  | "unexpected"; // any other status, a redirect, or a body of the wrong shape

export interface StaffPortalError {
  kind: StaffPortalErrorKind;
  status: number | null;
  message: string;
  retryAfterSeconds: number | null;
  /** The portal's error body, parsed if it was JSON, scrubbed of the key. For logging, never shown raw. */
  body: unknown;
}

export type StaffPortalResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; error: StaffPortalError };

type Config = { baseUrl: string; origin: string; serviceKey: string };

function failure(
  kind: StaffPortalErrorKind,
  message: string,
  extra: Partial<Pick<StaffPortalError, "status" | "retryAfterSeconds" | "body">> = {},
): { ok: false; error: StaffPortalError } {
  return { ok: false, error: { kind, message, status: null, retryAfterSeconds: null, body: null, ...extra } };
}

/**
 * Removes ONE matching pair of surrounding quotes, then trims. The cPanel launcher
 * can strip double quotes from an env value and leave a stray one, and a pasted
 * value may carry quotes either way; neither belongs in the header.
 */
export function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

// The error names the variable, never its value.
function readConfig(): { ok: true; config: Config } | { ok: false; error: StaffPortalError } {
  const baseUrl = stripSurroundingQuotes(process.env[STAFF_PORTAL_ENV.baseUrl] ?? "");
  const serviceKey = stripSurroundingQuotes(process.env[STAFF_PORTAL_ENV.serviceKey] ?? "");

  if (!baseUrl) return failure("config", `${STAFF_PORTAL_ENV.baseUrl} is not set.`);
  if (!serviceKey) return failure("config", `${STAFF_PORTAL_ENV.serviceKey} is not set.`);

  // Printable ASCII only: this also stops a pasted newline from reaching the
  // header, where the runtime's own error could quote the value. The team key's
  // internal format is the portal's business, so it is not checked beyond that.
  if (!/^[\x21-\x7e]+$/.test(serviceKey)) {
    return failure("config", `${STAFF_PORTAL_ENV.serviceKey} contains characters that are not allowed in a header.`);
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return failure("config", `${STAFF_PORTAL_ENV.baseUrl} is not a valid URL.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return failure("config", `${STAFF_PORTAL_ENV.baseUrl} must be https.`);
  }

  return { ok: true, config: { baseUrl: baseUrl.replace(/\/+$/, ""), origin: url.origin, serviceKey } };
}

function scrub(text: string, serviceKey: string): string {
  let out = text.split(serviceKey).join("[redacted]");
  // If the key is <id>.<secret>, also strip the secret part on its own.
  const dot = serviceKey.indexOf(".");
  if (dot >= 0) out = out.split(serviceKey.slice(dot + 1)).join("[redacted]");
  return out;
}

function scrubBody(body: unknown, serviceKey: string): unknown {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return scrub(body, serviceKey);
  return JSON.parse(scrub(JSON.stringify(body), serviceKey)) as unknown;
}

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

function kindForStatus(status: number): StaffPortalErrorKind {
  switch (status) {
    case 400:
    case 422:
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

const KIND_MESSAGE: Record<StaffPortalErrorKind, string> = {
  config: "The staff portal client is not configured.",
  network: "Could not reach the staff portal.",
  timeout: "The staff portal did not answer in time.",
  bad_request: "The staff portal refused the request.",
  unauthorized: "The staff portal rejected the service key.",
  forbidden: "The service key does not have the scope for this call.",
  not_found: "The staff portal has no such resource.",
  conflict: "The staff portal reports a conflict.",
  rate_limited: "The staff portal is rate limiting this service.",
  unavailable: "The staff portal is unavailable.",
  unexpected: "The staff portal returned something unexpected.",
};

interface RequestOptions<T> {
  parse: (raw: unknown) => T;
  timeoutMs?: number;
}

async function send<T>(
  method: "GET" | "POST",
  path: string,
  payload: unknown,
  options: RequestOptions<T>,
): Promise<StaffPortalResult<T>> {
  const configured = readConfig();
  if (!configured.ok) return configured;
  const { baseUrl, serviceKey } = configured.config;

  if (!path.startsWith("/")) return failure("config", "Staff portal paths must start with /.");

  const headers: Record<string, string> = { "X-Service-Key": serviceKey, Accept: "application/json" };
  if (method === "POST") headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
      // Never follow a redirect: it would carry the key to wherever it points.
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return failure("timeout", KIND_MESSAGE.timeout);
    }
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
    return failure("network", KIND_MESSAGE.network, { status: response.status });
  }

  // The staff portal signals success by HTTP status (no ok:false envelope).
  if (response.status >= 200 && response.status < 300) {
    try {
      return { ok: true, status: response.status, data: options.parse(body) };
    } catch (error) {
      const detail = error instanceof ShapeError ? ` ${error.message}` : "";
      return failure("unexpected", `The staff portal's response was not the shape expected.${detail}`, {
        status: response.status,
        body,
      });
    }
  }

  const kind = kindForStatus(response.status);
  return failure(kind, kind === "unexpected" ? `${KIND_MESSAGE.unexpected} (${response.status}).` : KIND_MESSAGE[kind], {
    status: response.status,
    retryAfterSeconds: retryAfter(response.headers),
    body,
  });
}

// ---------------------------------------------------------------------------
// Parsers (the same hand-written style as portal.ts; no shared import on purpose,
// so a change to one portal's contract cannot silently move the other).
// ---------------------------------------------------------------------------

class ShapeError extends Error {}

type Parser<T> = (raw: unknown, path: string) => T;

function mismatch(path: string, expected: string): never {
  throw new ShapeError(`${path || "(body)"}: expected ${expected}.`);
}

const str: Parser<string> = (raw, path) => (typeof raw === "string" ? raw : mismatch(path, "a string"));
const bool: Parser<boolean> = (raw, path) => (typeof raw === "boolean" ? raw : mismatch(path, "a boolean"));

function oneOf<const V extends readonly string[]>(values: V): Parser<V[number]> {
  return (raw, path) =>
    typeof raw === "string" && (values as readonly string[]).includes(raw)
      ? (raw as V[number])
      : mismatch(path, `one of ${values.join(" | ")}`);
}

function nullable<T>(inner: Parser<T>): Parser<T | null> {
  return (raw, path) => (raw === null ? null : inner(raw, path));
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

function list<T>(inner: Parser<T>): Parser<T[]> {
  return (raw, path) =>
    Array.isArray(raw) ? raw.map((item: unknown, index) => inner(item, `${path}[${index}]`)) : mismatch(path, "an array");
}

// ----- GET /api/team/v1/staff ------------------------------------------------

export const TEAM_ROLES = ["CEO", "GM", "Director", "HOD", "Staff"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  department: string | null;
  role: TeamRole;
}

const parseStaffMember = object({
  id: str,
  full_name: str,
  email: str,
  department: nullable(str),
  role: oneOf(TEAM_ROLES),
});

// Top-level { staff: [...] }, NOT the client portal's { data } envelope.
const parseStaffList = (raw: unknown): StaffMember[] => {
  const { staff } = object({ staff: list(parseStaffMember) })(raw, "");
  return staff.map((member) => ({
    id: member.id,
    fullName: member.full_name,
    email: member.email,
    department: member.department,
    role: member.role,
  }));
};

export function listStaffPortalStaff(): Promise<StaffPortalResult<StaffMember[]>> {
  return send("GET", "/api/team/v1/staff", undefined, { parse: parseStaffList });
}

// ----- POST /api/team/v1/tasks -----------------------------------------------

export interface CreateStaffTaskBody {
  /** A fresh unique key per assignment; a replay returns the same task, no duplicate. */
  idempotencyKey: string;
  assigneeEmail: string;
  title: string;
  description: string;
  /** Always "css" for this integration. */
  source: string;
  /** The client portal's case id (opaque). */
  sourceRef: string;
  /** A deep link back to the complaint in CSS. Omitted when CSS_PUBLIC_ORIGIN is unset. */
  sourceUrl?: string;
  /** A fixed UI priority, or omitted. */
  priority?: string;
}

export interface CreateStaffTaskResult {
  taskId: string;
  /** The web path to the task on the staff portal, as returned (e.g. "/tasks/abc"). */
  linkPath: string;
  /** linkPath resolved against the staff portal's origin, for a clickable "view task". */
  taskUrl: string;
  /** True when the idempotency key matched an existing task (HTTP 200); false on a fresh create (HTTP 201). */
  replayed: boolean;
}

const parseTaskResult = object({ ok: (raw, path) => (raw === true ? true : mismatch(path, "true")), taskId: str, linkPath: str, replayed: bool });

export function createStaffTask(body: CreateStaffTaskBody): Promise<StaffPortalResult<CreateStaffTaskResult>> {
  const configured = readConfig();
  const origin = configured.ok ? configured.config.origin : "";
  return send("POST", "/api/team/v1/tasks", body, {
    parse: (raw): CreateStaffTaskResult => {
      const parsed = parseTaskResult(raw, "");
      // linkPath is a path; join it to the portal origin for a usable link.
      const taskUrl = parsed.linkPath.startsWith("/") && origin ? `${origin}${parsed.linkPath}` : parsed.linkPath;
      return { taskId: parsed.taskId, linkPath: parsed.linkPath, taskUrl, replayed: parsed.replayed };
    },
  });
}
