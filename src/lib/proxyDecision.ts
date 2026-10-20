// What the proxy does, as a pure function, so it can be tested without Next.
// src/proxy.ts is a thin shell around this.
//
// It is deliberately tiny: if there is no session cookie at all, go and sign in
// (remembering where you were going); otherwise pass the request on and record
// its path for server components. It does NOT decide whether a session is valid
// and cannot: that needs the database (see src/proxy.ts and src/lib/auth.ts).

export type ProxyDecision =
  | { action: "sign_in"; to: string } // a path and query on this site
  | { action: "continue"; path: string };

export function decideProxy(input: { pathname: string; search: string; hasSessionCookie: boolean }): ProxyDecision {
  const path = input.pathname + input.search;
  if (input.pathname !== "/login" && !input.hasSessionCookie) {
    return { action: "sign_in", to: `/login?next=${encodeURIComponent(path)}` };
  }
  return { action: "continue", path };
}
