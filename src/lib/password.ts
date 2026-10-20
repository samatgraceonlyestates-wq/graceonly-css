// Password hashing: scrypt from node:crypto. No dependency.
//
// STORED FORMAT (one string, in staff.password_hash):
//
//     scrypt$N=32768,r=8,p=1,len=64$<salt>$<hash>
//
//   scrypt           the algorithm, so another one can be added later
//   N=,r=,p=         the scrypt cost parameters this hash was made with
//   len=             the derived key length in bytes (64)
//   <salt>           16 random bytes, base64url
//   <hash>           the derived key, base64url (64 bytes)
//
// The parameters live IN the string, so raising them later needs no migration:
// verify() reads them from the stored hash, and on the next successful login
// needsRehash() says "these are not today's parameters" and the caller stores a
// fresh hash made with the new ones, one user at a time.
//
// THE maxmem TRAP. Node's crypto.scrypt refuses any parameters that need more
// than 32 MiB (33,554,432 bytes) unless `maxmem` is raised. N=32768, r=8, p=1
// needs 128 * r * (N + p + 2) = 33,557,504 bytes, which is 3,072 over, so it
// THROWS with the defaults. maxmemFor() derives the limit from the parameters
// (with headroom), so changing them cannot bring the problem back.
//
// A plaintext password is never logged, never put in an error, never returned.
// Every error here is a fixed string. Passwords are NFKC-normalised first so the
// same characters typed in a different Unicode form still match.
//
// Pure: node:crypto only, no database, no Next. Relative imports with .ts
// extensions are not needed here (no imports of our own).
import { randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual } from "node:crypto";

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  /** Derived key length in bytes. */
  keyLength: number;
}

/** Today's parameters. Changing them is a decision: every stored hash is then "outdated" and upgraded at next login. */
export const CURRENT_PARAMS: Readonly<ScryptParams> = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 64 });
export const SALT_BYTES = 16;

const MAX_MEMORY_FOR_VERIFY = 256 * 1024 * 1024; // refuse a stored hash that would need more than this
const MAX_PASSWORD_CHARS = 1024; // longer is not a password; checked before any work is done

export function maxmemFor(params: ScryptParams): number {
  return Math.ceil(128 * params.r * (params.N + params.p + 2) * 1.25);
}

function memoryNeeded(params: ScryptParams): number {
  return 128 * params.r * (params.N + params.p + 2);
}

export class PasswordBusyError extends Error {
  constructor() {
    super("Too many password checks are waiting.");
    this.name = "PasswordBusyError";
  }
}

export interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PARAMS = /^N=(\d+),r=(\d+),p=(\d+),len=(\d+)$/;

/** Reads a stored hash, or returns null if it is not one we could have written. Never throws. */
export function parseHash(stored: unknown): ParsedHash | null {
  if (typeof stored !== "string" || stored.length > 512) return null;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return null;
  const match = PARAMS.exec(parts[1] ?? "");
  if (match === null) return null;
  const params: ScryptParams = {
    N: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
    keyLength: Number(match[4]),
  };
  const powerOfTwo = params.N >= 1024 && params.N <= 1 << 20 && (params.N & (params.N - 1)) === 0;
  if (!powerOfTwo || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 16) return null;
  if (params.keyLength < 16 || params.keyLength > 128) return null;
  if (memoryNeeded(params) > MAX_MEMORY_FOR_VERIFY) return null;
  const saltText = parts[2] ?? "";
  const hashText = parts[3] ?? "";
  if (!BASE64URL.test(saltText) || !BASE64URL.test(hashText)) return null;
  const salt = Buffer.from(saltText, "base64url");
  const hash = Buffer.from(hashText, "base64url");
  if (salt.length < 8 || salt.length > 64 || hash.length !== params.keyLength) return null;
  return { params, salt, hash };
}

function encode(params: ScryptParams, salt: Buffer, hash: Buffer): string {
  return `scrypt$N=${params.N},r=${params.r},p=${params.p},len=${params.keyLength}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function normalise(password: string): string {
  return password.normalize("NFKC");
}

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      Buffer.from(normalise(password), "utf8"),
      salt,
      params.keyLength,
      { N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params) },
      (error, key) => {
        // The error is replaced: it is ours to word, and must never carry input.
        if (error) reject(new Error("Password hashing failed."));
        else resolve(key);
      },
    );
  });
}

// A small gate so a burst of logins cannot hold many 34 MB scrypt buffers at
// once on a shared host. Two run at a time; a short queue waits; beyond that the
// caller is told to try again rather than the process swelling.
class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly max: number;
  private readonly maxQueue: number;

  constructor(max: number, maxQueue: number) {
    this.max = max;
    this.maxQueue = maxQueue;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxQueue) throw new PasswordBusyError();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // hand the slot straight to the next waiter
      else this.active -= 1;
    }
  }
}

export interface PasswordHasher {
  readonly params: Readonly<ScryptParams>;
  /** A fresh stored string for this password. */
  hash(password: string): Promise<string>;
  /**
   * True only if `password` matches `stored`. PASS null FOR "NO SUCH ACCOUNT": it
   * does exactly the same amount of work against a dummy hash and returns false,
   * so a missing account cannot be told from a wrong password by timing.
   * Never throws for bad input; a malformed stored hash is treated as no match
   * (after the same work).
   */
  verify(password: string, stored: string | null): Promise<boolean>;
  /** True if `stored` was made with other parameters than this hasher's current ones. */
  needsRehash(stored: string): boolean;
}

export interface HasherOptions {
  params?: ScryptParams;
  /** A valid hash made with `params`. Computed if omitted (blocks briefly; only for cheap test parameters). */
  dummyHash?: string;
  concurrency?: number;
  maxQueue?: number;
}

export function createPasswordHasher(options: HasherOptions = {}): PasswordHasher {
  const params = options.params ?? CURRENT_PARAMS;
  const gate = new Gate(options.concurrency ?? 2, options.maxQueue ?? 64);

  let dummy = options.dummyHash;
  if (dummy === undefined) {
    const salt = Buffer.alloc(SALT_BYTES, 7);
    const key = scryptSync("no-such-account-placeholder", salt, params.keyLength, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: maxmemFor(params),
    });
    dummy = encode(params, salt, key);
  }
  const dummyParsed = parseHash(dummy);
  if (dummyParsed === null) throw new Error("The dummy password hash is not a valid hash.");

  return {
    params,

    async hash(password) {
      if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_CHARS) {
        throw new Error("Password is not acceptable.");
      }
      const salt = randomBytes(SALT_BYTES);
      const key = await gate.run(() => derive(password, salt, params));
      return encode(params, salt, key);
    },

    async verify(password, stored) {
      const parsed = stored === null ? null : parseHash(stored);
      const target = parsed ?? dummyParsed;
      const usable = typeof password === "string" && password.length <= MAX_PASSWORD_CHARS;
      // Same work whatever is wrong: derive against the real or the dummy hash.
      const key = await gate.run(() => derive(usable ? password : "", target.salt, target.params));
      const equal = key.length === target.hash.length && timingSafeEqual(key, target.hash);
      return equal && parsed !== null && usable;
    },

    needsRehash(stored) {
      const parsed = parseHash(stored);
      if (parsed === null) return false; // cannot be verified at all; nothing to upgrade
      return (
        parsed.params.N !== params.N ||
        parsed.params.r !== params.r ||
        parsed.params.p !== params.p ||
        parsed.params.keyLength !== params.keyLength
      );
    },
  };
}

// A real hash, at today's parameters, of a random string nobody knows. It is
// verified against when no account matches an email. It is not a secret.
// password.test.ts fails if CURRENT_PARAMS change without this being regenerated.
export const DUMMY_HASH = "scrypt$N=32768,r=8,p=1,len=64$ASG_pZvhne-r4kYgcQ_Flw$Pcl0vSvgroXbLlbKU-vR-7FBddW1HjY4-FARcMnQsWvN2r-DphvyOU_cc5zIVOLFtffyHGjTjEFxtigXsnwjzQ";

export const passwords: PasswordHasher = createPasswordHasher({ dummyHash: DUMMY_HASH });
