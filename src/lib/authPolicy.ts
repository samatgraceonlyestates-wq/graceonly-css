// Authentication policy: the numbers, and the small pure decisions built on them.
// Pure on purpose, with no imports: the proxy (which must stay light), the
// server code and the tests all read it.
//
// Everything that decides whether someone is IN lives in server code that can
// reach the database (authCore.ts, auth.ts). This file holds only constants and
// decisions that need no database.

export const AUTH_POLICY = Object.freeze({
  /** A session is invalid this long after it was created, however busy it was. */
  sessionAbsoluteHours: 12,
  /** A session is invalid after this long without a request. */
  sessionIdleHours: 3,
  /** last_seen_at is refreshed at most this often, so a page does not write on every request. */
  touchIntervalMinutes: 1,

  /** This many failures in a row lock the account. A success resets the count. */
  lockAfterFailures: 5,
  lockMinutes: 15,

  /**
   * Failed logins allowed per IP address in the window. Deliberately higher than
   * the per-account number: the whole office can sit behind ONE address, and
   * 20 to 30 staff must not lock each other out. It exists to stop one address
   * trying many accounts, which the per-account lock alone does not.
   */
  ipFailureLimit: 20,
  ipWindowMinutes: 15,

  passwordMinLength: 12,
  passwordMaxLength: 128,
});

export const SESSION_COOKIE = "css_session";

/** A session token as the browser holds it: 32 random bytes, base64url, no padding. */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
}

/**
 * httpOnly (script cannot read it), sameSite=lax, path=/. `secure` is on in
 * production and OFF otherwise, decided from the environment and never hard-coded:
 * a browser will not keep a Secure cookie that arrived over plain http, so on
 * http://localhost (development) it would silently never be stored and nobody
 * could sign in. (Browsers make an exception for localhost, but not for another
 * host name or an IP over http, so do not rely on it.)
 * maxAge is the absolute lifetime; the idle timeout is enforced on the server.
 */
export function sessionCookieOptions(nodeEnv: string | undefined): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: nodeEnv === "production",
    maxAge: AUTH_POLICY.sessionAbsoluteHours * 60 * 60,
  };
}

// ---------------------------------------------------------------------------
// Input

export const MAX_EMAIL_LENGTH = 254;

/** Trim only. Matching is case-insensitive in the database (lower(email)). */
export function normaliseEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function looksLikeEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+$/.test(email);
}

/** The rules for a NEW password. Returns a message for the person, or null if it is acceptable. Never echoes the password. */
export function validateNewPassword(password: unknown, current?: string): string | null {
  if (typeof password !== "string") return "Enter a new password.";
  const length = [...password].length;
  if (length < AUTH_POLICY.passwordMinLength) {
    return `Use at least ${AUTH_POLICY.passwordMinLength} characters.`;
  }
  if (length > AUTH_POLICY.passwordMaxLength) {
    return `Use at most ${AUTH_POLICY.passwordMaxLength} characters.`;
  }
  if (password.trim().length === 0) return "A password cannot be only spaces.";
  if (current !== undefined && password === current) return "The new password must be different from the current one.";
  return null;
}

// ---------------------------------------------------------------------------
// Where to go after signing in

export const DEFAULT_LANDING = "/dashboard";

const NEVER_A_DESTINATION = ["/login", "/change-password"];

/**
 * The page to send someone to after they sign in: the one they were heading for,
 * if it is a path on THIS site and nowhere else. Anything that could leave the
 * site (an absolute URL, //host, a backslash, a control character) or loop back
 * into the sign-in flow becomes the dashboard. Open redirects start here.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return DEFAULT_LANDING;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return DEFAULT_LANDING;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_LANDING;
  let url: URL;
  try {
    url = new URL(raw, "http://css.invalid");
  } catch {
    return DEFAULT_LANDING;
  }
  if (url.origin !== "http://css.invalid") return DEFAULT_LANDING;
  if (NEVER_A_DESTINATION.some((blocked) => url.pathname === blocked || url.pathname.startsWith(`${blocked}/`))) {
    return DEFAULT_LANDING;
  }
  return url.pathname + url.search;
}

// ---------------------------------------------------------------------------
// Roles (staff_role). Gates are enforced in the server code that loads data;
// anything in the browser is a hint, never a gate.

export type RoleCode = "FRONT_DESK" | "LEGAL" | "ADMIN" | "SUPER_ADMIN";

// A Super Admin can do what an Admin can. No other role implies another.
const SATISFIED_BY: Readonly<Record<RoleCode, readonly RoleCode[]>> = {
  FRONT_DESK: ["FRONT_DESK"],
  LEGAL: ["LEGAL"],
  ADMIN: ["ADMIN", "SUPER_ADMIN"],
  SUPER_ADMIN: ["SUPER_ADMIN"],
};

export function roleAllows(held: readonly string[], needed: RoleCode): boolean {
  return SATISFIED_BY[needed].some((role) => held.includes(role));
}

export interface AccessSubject {
  roles: readonly string[];
  mustChangePassword: boolean;
}

export interface AccessRequirement {
  role?: RoleCode;
  /** Only the change-password screen and its action set this. */
  allowPasswordChange?: boolean;
}

export type AccessDecision =
  | { ok: true }
  | { ok: false; reason: "must_change_password" | "forbidden" };

/**
 * The one decision every gate uses. A person who must change their password gets
 * nothing but the change-password screen, whatever role they hold.
 */
export function decideAccess(subject: AccessSubject, requirement: AccessRequirement = {}): AccessDecision {
  if (subject.mustChangePassword && requirement.allowPasswordChange !== true) {
    return { ok: false, reason: "must_change_password" };
  }
  if (requirement.role !== undefined && !roleAllows(subject.roles, requirement.role)) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The caller's address

/**
 * The client address for rate limiting, from the proxy headers, or null.
 *
 * Behind a reverse proxy, X-Forwarded-For is a list the PROXY appends to: the
 * LAST entry is the address the proxy itself saw connect, and everything before it
 * is whatever the client claimed. So the last entry is the only one to trust, and
 * only when exactly one proxy sits in front. If the app is ever reachable
 * directly, a client can send any header it likes and this is meaningless;
 * confirm how the host presents the client address before relying on it.
 *
 * Returned as text; the caller validates it before storing it in an inet column.
 */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for");
  let candidate: string | null = null;
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    candidate = parts[parts.length - 1] ?? null;
  } else {
    candidate = headers.get("x-real-ip")?.trim() || null;
  }
  if (candidate === null || candidate.length > 45) return null;
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/.exec(candidate);
  if (v4?.[1]) return v4[1];
  if (/^[0-9a-fA-F:]+$/.test(candidate) && candidate.includes(":")) return candidate;
  return null;
}
