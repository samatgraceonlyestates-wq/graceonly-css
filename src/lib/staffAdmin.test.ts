// Creating a staff account, against a fake pool: no database. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDb, type ClientLike, type PoolLike } from "./dbCore.ts";
import { createPasswordHasher } from "./password.ts";
import { ROLE_CODES, StaffInputError, createStaffAccount } from "./staffAdmin.ts";

const CANARY = "CANARY-PASSWORD-9f3a-Zq7!-long-enough";
const hasher = createPasswordHasher({ params: { N: 1024, r: 8, p: 1, keyLength: 64 } });

function harness(failOn?: string) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const client: ClientLike = {
    async query(text, values) {
      calls.push({ text, values });
      if (failOn && text.includes(failOn)) throw Object.assign(new Error("boom CANARY-ROW"), { code: "23505", constraint: "staff_email_lower_key", table: "staff" });
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool: PoolLike = { query: client.query, connect: async () => client };
  const db = createDb(() => pool, { log: () => {} });
  return { calls, deps: { hasher, transaction: db.transaction, newId: () => "00000000-0000-4000-8000-0000000000aa" } };
}

const GOOD = { email: "Grace.Obi@Example.test", fullName: "Grace Obi", department: "Front desk", roles: ["admin"], password: CANARY };

describe("createStaffAccount", () => {
  it("inserts the staff row with must_change_password, the roles, and an audit entry, in ONE transaction", async () => {
    const { calls, deps } = harness();
    const created = await createStaffAccount(GOOD, deps);
    assert.deepEqual(created, { id: "00000000-0000-4000-8000-0000000000aa", email: "Grace.Obi@Example.test", roles: ["ADMIN"] });
    const texts = calls.map((call) => call.text.replace(/\s+/g, " ").trim());
    assert.equal(texts[0], "BEGIN");
    assert.match(texts[1] ?? "", /^INSERT INTO staff \(id, email, full_name, department, password_hash, must_change_password\) VALUES \(\$1, \$2, \$3, \$4, \$5, true\)$/);
    assert.match(texts[2] ?? "", /^INSERT INTO staff_role/);
    assert.match(texts[3] ?? "", /^INSERT INTO audit_log/);
    assert.equal(texts[4], "COMMIT");
  });

  it("stores a scrypt hash, never the password", async () => {
    const { calls, deps } = harness();
    await createStaffAccount(GOOD, deps);
    const insert = calls.find((call) => call.text.includes("INSERT INTO staff ("));
    assert.ok(String(insert?.values[4]).startsWith("scrypt$"));
    assert.ok(!JSON.stringify(calls).includes("CANARY-PASSWORD"), "the password is in no query text and no parameter");
  });

  it("the audit entry carries no email and no hash", async () => {
    const { calls, deps } = harness();
    await createStaffAccount(GOOD, deps);
    const audit = calls.find((call) => call.text.includes("INSERT INTO audit_log"));
    const text = JSON.stringify(audit?.values);
    assert.ok(!text.includes("example.test") && !text.includes("scrypt$"));
  });

  it("accepts several roles, once each, in any case", async () => {
    const { deps } = harness();
    const created = await createStaffAccount({ ...GOOD, roles: ["front_desk", "FRONT_DESK", " legal "] }, deps);
    assert.deepEqual(created.roles, ["FRONT_DESK", "LEGAL"]);
  });

  const refusals: [string, Partial<typeof GOOD>, RegExp][] = [
    ["a bad email", { email: "not-an-email" }, /valid email/],
    ["a blank name", { fullName: "   " }, /full name/],
    ["a blank department", { department: "" }, /department/],
    ["no role", { roles: [] }, /at least one role/],
    ["an unknown role", { roles: ["PRESIDENT"] }, /Unknown role/],
    ["a weak password", { password: "short" }, /at least 12/],
  ];
  for (const [name, change, message] of refusals) {
    it(`refuses ${name}, before touching the database`, async () => {
      const { calls, deps } = harness();
      await assert.rejects(createStaffAccount({ ...GOOD, ...change }, deps), (error: Error) => error instanceof StaffInputError && message.test(error.message));
      assert.equal(calls.length, 0);
    });
  }

  it("a duplicate email is a DbError with the fixed message, and no password in it", async () => {
    const { deps } = harness("INSERT INTO staff (");
    await assert.rejects(createStaffAccount(GOOD, deps), (error: Error) => {
      const text = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;
      assert.equal(error.name, "DbError");
      assert.match(error.message, /already exists/);
      assert.ok(!text.includes("CANARY"));
      return true;
    });
  });

  it("knows the four roles", () => {
    assert.deepEqual([...ROLE_CODES], ["FRONT_DESK", "LEGAL", "ADMIN", "SUPER_ADMIN"]);
  });
});
