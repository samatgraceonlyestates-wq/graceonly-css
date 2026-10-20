// The pure policy: numbers, redirect safety, cookie options, roles, the gate
// decision, the client address. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTH_POLICY,
  DEFAULT_LANDING,
  SESSION_COOKIE,
  clientIp,
  decideAccess,
  looksLikeEmail,
  roleAllows,
  safeNext,
  sessionCookieOptions,
  validateNewPassword,
  type RoleCode,
} from "./authPolicy.ts";

describe("the numbers", () => {
  it("are exactly what was asked for", () => {
    assert.equal(AUTH_POLICY.sessionAbsoluteHours, 12);
    assert.equal(AUTH_POLICY.sessionIdleHours, 3);
    assert.equal(AUTH_POLICY.lockAfterFailures, 5);
    assert.equal(AUTH_POLICY.lockMinutes, 15);
  });
});

describe("the session cookie", () => {
  it("is httpOnly, sameSite=lax, path=/ and lives as long as the absolute lifetime", () => {
    const options = sessionCookieOptions("production");
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/");
    assert.equal(options.maxAge, 12 * 60 * 60);
    assert.equal(SESSION_COOKIE, "css_session");
  });

  it("is Secure in production and not otherwise (decided by the environment, not hard-coded)", () => {
    assert.equal(sessionCookieOptions("production").secure, true);
    assert.equal(sessionCookieOptions("development").secure, false);
    assert.equal(sessionCookieOptions("test").secure, false);
    assert.equal(sessionCookieOptions(undefined).secure, false);
  });
});

describe("safeNext: where to go after signing in", () => {
  it("keeps a path on this site, with its query", () => {
    assert.equal(safeNext("/visits/new"), "/visits/new");
    assert.equal(safeNext("/complaints?status=resolved"), "/complaints?status=resolved");
    assert.equal(safeNext("/visits/6c5f0c9e-0000-4000-8000-000000000001"), "/visits/6c5f0c9e-0000-4000-8000-000000000001");
  });

  it("turns everything that could leave the site, or loop, into the dashboard", () => {
    const hostile = [
      undefined,
      null,
      "",
      42,
      "dashboard",
      "https://evil.example/",
      "http://evil.example",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/..\\..\\evil",
      "javascript:alert(1)",
      "/ok\nSet-Cookie: a=b",
      "/ok\r\nLocation: https://evil.example",
      "/\t/evil.example",
      "/login",
      "/login?next=/dashboard",
      "/login/",
      "/change-password",
      "/" + "a".repeat(600),
    ];
    for (const value of hostile) assert.equal(safeNext(value), DEFAULT_LANDING, JSON.stringify(value));
  });

  it("never returns anything but a path starting with a single slash", () => {
    for (const value of ["/a", "/a/b?c=d", "/%2f/evil.example", "/a%0d%0ab"]) {
      const result = safeNext(value);
      assert.ok(result.startsWith("/") && !result.startsWith("//"), result);
    }
  });
});

describe("validateNewPassword", () => {
  it("wants 12 to 128 characters", () => {
    assert.match(validateNewPassword("short") ?? "", /at least 12/);
    assert.match(validateNewPassword("x".repeat(129)) ?? "", /at most 128/);
    assert.equal(validateNewPassword("x".repeat(12)), null);
    assert.equal(validateNewPassword("x".repeat(128)), null);
  });

  it("counts characters, not bytes", () => {
    assert.equal(validateNewPassword("é".repeat(12)), null);
  });

  it("refuses only spaces, the current password, and non-strings", () => {
    assert.match(validateNewPassword(" ".repeat(20)) ?? "", /only spaces/);
    assert.match(validateNewPassword("a long enough one", "a long enough one") ?? "", /different/);
    assert.equal(validateNewPassword("a long enough one", "something else"), null);
    assert.match(validateNewPassword(undefined) ?? "", /Enter a new password/);
  });

  it("never echoes the password back in its message", () => {
    const secret = "S3cretValue-should-not-appear";
    for (const attempt of [validateNewPassword(secret, secret), validateNewPassword(secret.slice(0, 5))]) {
      assert.ok(!(attempt ?? "").includes("S3cret"));
    }
  });
});

describe("looksLikeEmail", () => {
  it("accepts an address and rejects what cannot be one", () => {
    assert.ok(looksLikeEmail("grace@graceonlyestates.com"));
    for (const bad of ["", "no-at-sign", "two@@signs.example", "has space@example.test", "@nothing", "nothing@", "x".repeat(260) + "@e.test"]) {
      assert.ok(!looksLikeEmail(bad), bad);
    }
  });
});

describe("roles", () => {
  const cases: [string[], RoleCode, boolean][] = [
    [["ADMIN"], "ADMIN", true],
    [["SUPER_ADMIN"], "ADMIN", true], // a Super Admin can do what an Admin can
    [["FRONT_DESK"], "ADMIN", false],
    [["LEGAL"], "ADMIN", false],
    [["FRONT_DESK", "LEGAL"], "ADMIN", false],
    [[], "ADMIN", false],
    [["ADMIN"], "SUPER_ADMIN", false], // but not the other way round
    [["SUPER_ADMIN"], "SUPER_ADMIN", true],
    [["ADMIN"], "FRONT_DESK", false], // no other role implies another
    [["FRONT_DESK"], "FRONT_DESK", true],
    [["LEGAL", "ADMIN"], "LEGAL", true],
  ];
  for (const [held, needed, expected] of cases) {
    it(`${JSON.stringify(held)} -> ${needed}: ${expected}`, () => {
      assert.equal(roleAllows(held, needed), expected);
    });
  }

  it("the role gate REFUSES a non-admin and admits an admin", () => {
    const frontDesk = { roles: ["FRONT_DESK"], mustChangePassword: false };
    const admin = { roles: ["ADMIN"], mustChangePassword: false };
    assert.deepEqual(decideAccess(frontDesk, { role: "ADMIN" }), { ok: false, reason: "forbidden" });
    assert.deepEqual(decideAccess(admin, { role: "ADMIN" }), { ok: true });
    assert.deepEqual(decideAccess(frontDesk), { ok: true }, "no role required: any signed-in person");
  });

  it("must-change-password is checked before the role", () => {
    assert.deepEqual(decideAccess({ roles: [], mustChangePassword: true }, { role: "ADMIN" }), { ok: false, reason: "must_change_password" });
  });
});

describe("clientIp", () => {
  const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

  it("takes the LAST X-Forwarded-For entry: the one the proxy itself saw", () => {
    assert.equal(clientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })), "203.0.113.7");
    assert.equal(clientIp(headers({ "x-forwarded-for": "6.6.6.6" })), "6.6.6.6");
  });

  it("a client cannot choose its own address by prepending to the list", () => {
    assert.equal(clientIp(headers({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.7" })), "203.0.113.7");
  });

  it("falls back to X-Real-IP, strips a port, and accepts IPv6", () => {
    assert.equal(clientIp(headers({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
    assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.7:51234" })), "203.0.113.7");
    assert.equal(clientIp(headers({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
  });

  it("is null when there is nothing usable, rather than a guess", () => {
    assert.equal(clientIp(headers({})), null);
    assert.equal(clientIp(headers({ "x-forwarded-for": "not an address" })), null);
    assert.equal(clientIp(headers({ "x-forwarded-for": "" })), null);
  });
});
