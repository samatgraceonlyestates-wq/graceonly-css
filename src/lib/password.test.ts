// Password hashing. Pure. Run: npm test
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { describe, it } from "node:test";
import {
  CURRENT_PARAMS,
  DUMMY_HASH,
  PasswordBusyError,
  createPasswordHasher,
  maxmemFor,
  parseHash,
  passwords,
} from "./password.ts";

const CHEAP = { N: 1024, r: 8, p: 1, keyLength: 64 } as const;
const cheap = createPasswordHasher({ params: CHEAP });
const CANARY = "CANARY-PASSWORD-9f3a-Zq7!";

describe("the parameters and the stored format", () => {
  it("are N=32768, r=8, p=1, a 64-byte key and a 16-byte salt", () => {
    assert.deepEqual({ ...CURRENT_PARAMS }, { N: 32768, r: 8, p: 1, keyLength: 64 });
  });

  it("a stored hash carries its own parameters, salt and hash", async () => {
    const stored = await cheap.hash("a perfectly ordinary passphrase");
    assert.match(stored, /^scrypt\$N=1024,r=8,p=1,len=64\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    const parsed = parseHash(stored);
    assert.ok(parsed);
    assert.deepEqual(parsed.params, CHEAP);
    assert.equal(parsed.salt.length, 16);
    assert.equal(parsed.hash.length, 64);
  });

  it("uses a different random salt every time", async () => {
    const [a, b] = await Promise.all([cheap.hash("same password here"), cheap.hash("same password here")]);
    assert.notEqual(a, b);
    assert.notDeepEqual(parseHash(a)?.salt, parseHash(b)?.salt);
  });

  it("the dummy hash is a real hash at TODAY's parameters (regenerate it if they change)", () => {
    const parsed = parseHash(DUMMY_HASH);
    assert.ok(parsed, "DUMMY_HASH is a valid stored hash");
    assert.deepEqual(parsed.params, { ...CURRENT_PARAMS });
    assert.equal(passwords.needsRehash(DUMMY_HASH), false);
  });
});

describe("the maxmem trap", () => {
  it("scrypt at these parameters THROWS with Node's default maxmem (so it must be raised)", () => {
    assert.throws(
      () => scryptSync("password", randomBytes(16), 64, { N: 32768, r: 8, p: 1 }),
      (error: NodeJS.ErrnoException) => error.code === "ERR_CRYPTO_INVALID_SCRYPT_PARAMS" || /memory/i.test(error.message),
    );
  });

  it("needs 128 * r * (N + p + 2) bytes, 3,072 over the 32 MiB default; maxmemFor() clears it", () => {
    const needed = 128 * 8 * (32768 + 1 + 2);
    assert.equal(needed, 33_557_504);
    assert.equal(needed - 32 * 1024 * 1024, 3072);
    assert.ok(needed > 32 * 1024 * 1024);
    assert.ok(maxmemFor(CURRENT_PARAMS) > needed);
  });

  it("hashes and verifies at the REAL parameters without throwing", async () => {
    const stored = await passwords.hash("a perfectly ordinary passphrase");
    assert.ok(stored.startsWith("scrypt$N=32768,r=8,p=1,len=64$"));
    assert.equal(await passwords.verify("a perfectly ordinary passphrase", stored), true);
    assert.equal(await passwords.verify("a perfectly ordinary passphrasf", stored), false);
  });
});

describe("verify", () => {
  it("accepts the right password and refuses a wrong one", async () => {
    const stored = await cheap.hash("correct horse battery staple");
    assert.equal(await cheap.verify("correct horse battery staple", stored), true);
    assert.equal(await cheap.verify("correct horse battery stapl", stored), false);
    assert.equal(await cheap.verify("", stored), false);
  });

  it("null means 'no such account': same work, always false", async () => {
    assert.equal(await cheap.verify("anything at all", null), false);
  });

  it("a malformed, truncated or hostile stored string is just 'no match'", async () => {
    const good = await cheap.hash("correct horse battery staple");
    const bad = [
      "",
      "garbage",
      "scrypt$N=1024,r=8,p=1,len=64$onlysalt",
      good.slice(0, -4),
      good.replace("N=1024", "N=1000"), // not a power of two
      good.replace("N=1024", "N=2097152"), // over the cap
      good.replace("r=8", "r=64"),
      good.replace("p=1", "p=99"),
      good.replace("len=64", "len=8"),
      "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234", // bcrypt: not ours
      "scrypt$N=1024,r=8,p=1,len=64$!!!$???",
    ];
    for (const stored of bad) {
      assert.equal(parseHash(stored), null, stored);
      assert.equal(await cheap.verify("correct horse battery staple", stored), false, stored);
    }
  });

  it("does not throw for a wrong-length candidate or non-string input", async () => {
    const stored = await cheap.hash("correct horse battery staple");
    assert.equal(await cheap.verify("x".repeat(5000), stored), false);
    assert.equal(await cheap.verify(undefined as unknown as string, stored), false);
  });

  it("treats the same characters in a different Unicode form as the same password", async () => {
    const composed = "café au lait 2026";
    const decomposed = "café au lait 2026";
    const stored = await cheap.hash(composed);
    assert.equal(await cheap.verify(decomposed, stored), true);
  });

  it("verifies against the parameters IN the stored string, not the hasher's own", async () => {
    const old = createPasswordHasher({ params: { N: 2048, r: 8, p: 1, keyLength: 64 } });
    const stored = await old.hash("correct horse battery staple");
    assert.equal(await cheap.verify("correct horse battery staple", stored), true);
  });
});

describe("needsRehash", () => {
  it("is false at the current parameters and true at any other", async () => {
    const mine = await cheap.hash("correct horse battery staple");
    assert.equal(cheap.needsRehash(mine), false);
    const other = await createPasswordHasher({ params: { N: 2048, r: 8, p: 1, keyLength: 64 } }).hash("correct horse battery staple");
    assert.equal(cheap.needsRehash(other), true);
    const longer = await createPasswordHasher({ params: { N: 1024, r: 8, p: 1, keyLength: 32 } }).hash("correct horse battery staple");
    assert.equal(cheap.needsRehash(longer), true);
  });

  it("is false for a string that is not a hash at all (there is nothing to upgrade)", () => {
    assert.equal(cheap.needsRehash("garbage"), false);
  });
});

describe("limits", () => {
  it("refuses to hash an empty or enormous password", async () => {
    await assert.rejects(cheap.hash(""), /not acceptable/);
    await assert.rejects(cheap.hash("x".repeat(2000)), /not acceptable/);
  });

  it("says 'busy' instead of queueing without limit", async () => {
    const small = createPasswordHasher({ params: CHEAP, concurrency: 1, maxQueue: 1 });
    const results = await Promise.allSettled([small.hash("one password one"), small.hash("two password two"), small.hash("three password three")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(rejected.length, 1);
    assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof PasswordBusyError);
  });
});

describe("a plaintext password never appears in anything thrown", () => {
  it("not in errors from hashing or verifying", async () => {
    const seen: string[] = [];
    for (const attempt of [
      () => cheap.hash("x".repeat(5000) + CANARY),
      () => cheap.hash(""),
      () => cheap.verify(CANARY, "scrypt$N=1024,r=8,p=1,len=64$bad$bad"),
    ]) {
      try {
        const value = await attempt();
        seen.push(String(value));
      } catch (error) {
        seen.push(String(error), (error as Error).stack ?? "", JSON.stringify(error));
      }
    }
    const stored = await cheap.hash(CANARY);
    seen.push(stored, JSON.stringify(parseHash(stored)));
    assert.ok(!seen.join("\n").includes("CANARY-PASSWORD"));
  });
});
