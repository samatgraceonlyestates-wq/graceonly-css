// Authentication, as the app uses it: the Next-specific glue around authCore.ts.
// Cookies, request headers and redirects live here and nowhere else.
//
// SERVER-ONLY (db.ts, which authStore.ts imports, throws if loaded in a browser).
//
// WHERE THE GATES ARE. Every page and every server action calls requireSession()
// (or requireRole()) itself, at the top, in the code that loads the data. The
// layout calls it too, but a layout is NOT a gate: Next does not re-run it when
// you move between pages inside it, and a server action is a public POST endpoint
// that never touches a layout. The proxy (src/proxy.ts) only checks that a cookie
// is PRESENT, to send strangers to the sign-in page quickly; it cannot tell a
// valid session from a dead one, and nothing relies on it to.
//
// getSession() is wrapped in React's cache(): the layout and the page asking in
// the same request share one database lookup.
//
// No call to the portal anywhere on this path.
import { isIP } from "node:net";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthService, type SessionUser } from "./authCore.ts";
import { pgAuthStore } from "./authStore.ts";
import {
  DEFAULT_LANDING,
  SESSION_COOKIE,
  clientIp,
  decideAccess,
  safeNext,
  sessionCookieOptions,
  type RoleCode,
} from "./authPolicy.ts";
import { passwords } from "./password.ts";

if (typeof window !== "undefined") {
  throw new Error("src/lib/auth.ts is server-only and must never be imported into client code.");
}

export type { SessionUser } from "./authCore.ts";

export const authService = createAuthService({ store: pgAuthStore, passwords });

/** The page the request is for, as the proxy recorded it (path and query), or the dashboard. */
export async function requestPath(): Promise<string> {
  const list = await headers();
  return safeNext(list.get("x-css-path"));
}

/** The caller's address if it is a real IP, else null. */
export async function currentIp(): Promise<string | null> {
  const raw = clientIp(await headers());
  return raw !== null && isIP(raw) !== 0 ? raw : null;
}

/** The signed-in staff member, or null. Does not redirect. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined) return null;
  const result = await authService.resolveSession(token);
  return result.ok ? result.user : null;
});

/**
 * The gate for a page or a server action. Signed out: to the sign-in page, with
 * where they were going. Signed in but obliged to change their password: to the
 * change-password screen, and nothing else is reachable until they do.
 */
export async function requireSession(options: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getSession();
  if (user === null) {
    redirect(`/login?next=${encodeURIComponent(await requestPath())}`);
  }
  const decision = decideAccess(user, { allowPasswordChange: options.allowPasswordChange });
  if (!decision.ok) {
    redirect(`/change-password?next=${encodeURIComponent(await requestPath())}`);
  }
  return user;
}

/**
 * The gate for a role-restricted page. Returns whether the signed-in staff member
 * holds the role; the caller renders the screen only when `allowed`, and loads
 * no data otherwise. (Signed out, or obliged to change their password, still
 * redirect, exactly as requireSession does.)
 */
export async function requireRole(role: RoleCode): Promise<{ user: SessionUser; allowed: boolean }> {
  const user = await requireSession();
  return { user, allowed: decideAccess(user, { role }).ok };
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(process.env.NODE_ENV));
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export { DEFAULT_LANDING, safeNext };
