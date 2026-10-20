// Next's proxy (the renamed middleware). It does TWO cheap things and nothing else
// (the decision itself is in lib/proxyDecision.ts, where it is tested):
//
//  1. If there is no session cookie at all, send the visitor to the sign-in page,
//     remembering where they were going.
//  2. Pass the request's path on as a header, so a server component that finds
//     the session dead (expired, revoked, idle) can send them to the same place.
//
// It NEVER decides whether a session is valid. It cannot: that needs the
// database, and Next's docs say a proxy should not rely on shared modules or
// globals. (In Next 16 it runs on the Node.js runtime, not the edge, but the
// conclusion is the same.) A cookie that is present proves nothing: the real
// check is requireSession() in the page or server action that loads the data.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/authPolicy.ts";
import { decideProxy } from "./lib/proxyDecision.ts";

export function proxy(request: NextRequest) {
  const decision = decideProxy({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasSessionCookie: request.cookies.has(SESSION_COOKIE),
  });

  if (decision.action === "sign_in") {
    return NextResponse.redirect(new URL(decision.to, request.url));
  }

  // set() replaces anything the client sent under this name, so it cannot be forged.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-css-path", decision.path);
  return NextResponse.next({ request: { headers: forwarded } });
}

// Everything except Next's own assets and static files. This must stay a literal:
// Next ignores a matcher it cannot read at build time.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map|woff2?)$).*)"],
};
