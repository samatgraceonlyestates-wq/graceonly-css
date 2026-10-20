// What the proxy decides, tested as a pure function: no server. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { decideProxy } from "./proxyDecision.ts";
import { safeNext } from "./authPolicy.ts";

const decide = (pathname: string, search = "", hasSessionCookie = false) => decideProxy({ pathname, search, hasSessionCookie });

describe("a visitor with no session cookie", () => {
  for (const [pathname, search] of [
    ["/dashboard", ""],
    ["/visits", ""],
    ["/visits/new", ""],
    ["/visits/6c5f0c9e-0000-4000-8000-000000000001", ""],
    ["/attendance/register", ""],
    ["/complaints", "?status=resolved&x=1"],
    ["/", ""],
    ["/change-password", ""],
  ] as const) {
    it(`is sent to sign in from ${pathname}${search}, remembering where they were going`, () => {
      const decision = decide(pathname, search);
      assert.equal(decision.action, "sign_in");
      if (decision.action !== "sign_in") return;
      const url = new URL(decision.to, "https://css.example.test");
      assert.equal(url.pathname, "/login");
      assert.equal(url.searchParams.get("next"), pathname + search);
      // and the login page will accept that destination
      assert.equal(safeNext(url.searchParams.get("next")), pathname === "/change-password" ? "/dashboard" : pathname + search);
    });
  }

  it("may open the sign-in page itself (no redirect loop)", () => {
    assert.deepEqual(decide("/login"), { action: "continue", path: "/login" });
    assert.deepEqual(decide("/login", "?next=%2Fvisits"), { action: "continue", path: "/login?next=%2Fvisits" });
  });
});

describe("a visitor WITH a cookie", () => {
  it("is passed through whatever the cookie holds: the proxy cannot tell a live session from a dead one, and does not try", () => {
    for (const path of ["/dashboard", "/visits/new", "/attendance/register"]) {
      assert.deepEqual(decide(path, "", true), { action: "continue", path });
    }
  });

  it("passes the page's path and query on, for a server component that finds the session dead", () => {
    assert.deepEqual(decide("/visits/new", "?x=1", true), { action: "continue", path: "/visits/new?x=1" });
  });
});

describe("proxy.ts, the shell around it", () => {
  const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

  it("imports nothing that could reach the database", () => {
    const imports = [...source.matchAll(/^import .* from "([^"]+)";/gm)].map((match) => match[1]).sort();
    assert.deepEqual(imports, ["./lib/authPolicy.ts", "./lib/proxyDecision.ts", "next/server"]);
  });

  it("overwrites x-css-path with set(), so a client cannot forge it", () => {
    assert.match(source, /forwarded\.set\("x-css-path"/);
  });

  it("has a literal matcher that skips Next's assets and static files", () => {
    const literal = /matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]/.exec(source)?.[1];
    assert.ok(literal, "the matcher is a string literal Next can read at build time");
    const pattern = new RegExp(`^${JSON.parse(`"${literal}"`)}$`);
    for (const path of ["/dashboard", "/visits/new", "/login", "/", "/complaints"]) assert.ok(pattern.test(path), path);
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/logo.png", "/a/b/font.woff2"]) {
      assert.ok(!pattern.test(path), path);
    }
  });
});
