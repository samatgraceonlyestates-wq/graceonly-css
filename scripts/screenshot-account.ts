// Ensures a LOCAL-ONLY account for scripts/screenshots.ts to sign in with.
//
//   npm run shots:account
//
// HARD GUARD: refuses to run unless DATABASE_URL points at this machine (see
// src/lib/localDatabase.ts). It checks the URL before the database layer is even
// loaded, and again against the server's own answer once connected, so it cannot
// create an account on the cPanel server whatever the environment holds.
//
// The credentials live in .env.local (git-ignored) as CSS_SHOT_EMAIL and
// CSS_SHOT_PASSWORD. They are generated on first run and never printed. If the
// account already exists its password is reset to the stored one and
// must_change_password is cleared, so the run is repeatable.
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { assertLocalDatabaseUrl, NotLocalDatabaseError } from "../src/lib/localDatabase.ts";

const ENV_FILE = ".env.local";
const EMAIL_KEY = "CSS_SHOT_EMAIL";
const PASSWORD_KEY = "CSS_SHOT_PASSWORD";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

try {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
} catch (error) {
  fail(error instanceof NotLocalDatabaseError ? error.message : "Refusing to run: DATABASE_URL was not checked.");
}

// Only now is the database layer loaded.
const { query, transaction, sql, closeDb, DbError } = await import("../src/lib/db.ts");
const { passwords } = await import("../src/lib/password.ts");
const { normaliseEmail } = await import("../src/lib/authPolicy.ts");

function envFileValue(key: string): string | undefined {
  let text = "";
  try {
    text = readFileSync(ENV_FILE, "utf8");
  } catch {
    return undefined;
  }
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line === undefined ? undefined : line.slice(key.length + 1);
}

try {
  // Second check, against what the server says it is: a loopback address, or no
  // address at all (a unix socket). Anything else means the URL lied.
  const where = await query<{ addr: string | null }>(sql`SELECT host(inet_server_addr()) AS addr`);
  const addr = where.rows[0]?.addr ?? null;
  if (addr !== null && addr !== "127.0.0.1" && addr !== "::1") {
    await closeDb();
    fail("Refusing to run: the database server is not on this machine.");
  }

  let email = envFileValue(EMAIL_KEY);
  let password = envFileValue(PASSWORD_KEY);
  if (email === undefined || password === undefined) {
    email = "screenshots@css.localhost";
    password = randomBytes(24).toString("base64url");
    appendFileSync(
      ENV_FILE,
      `\n# Local-only screenshot account (scripts/screenshot-account.ts). Never use on a server.\n${EMAIL_KEY}=${email}\n${PASSWORD_KEY}=${password}\n`,
    );
  }
  email = normaliseEmail(email);
  const hash = await passwords.hash(password);

  const isNew = await transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>(sql`SELECT id FROM staff WHERE lower(email) = ${email}`);
    let id = existing.rows[0]?.id;
    const created = id === undefined;
    if (id === undefined) {
      id = randomUUID();
      await tx.query(sql`
        INSERT INTO staff (id, email, full_name, department, password_hash, must_change_password)
        VALUES (${id}, ${email}, ${"Screenshot Account"}, ${"Front desk"}, ${hash}, false)`);
      await tx.query(sql`
        INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, after)
        VALUES (NULL, ${"staff"}, ${id}, ${"CREATE"},
                ${JSON.stringify({ via: "screenshot-account script (local only)" })}::jsonb)`);
    } else {
      await tx.query(sql`
        UPDATE staff SET password_hash = ${hash}, must_change_password = false, is_active = true,
               deactivated_at = NULL, password_failed_count = 0, password_locked_until = NULL
         WHERE id = ${id}`);
    }
    // FRONT_DESK and ADMIN: the front-desk pages and the admin-only register (08).
    for (const role of ["FRONT_DESK", "ADMIN"]) {
      await tx.query(sql`
        INSERT INTO staff_role (staff_id, role_code)
        SELECT ${id}, ${role}
         WHERE NOT EXISTS (SELECT 1 FROM staff_role WHERE staff_id = ${id} AND role_code = ${role})`);
    }
    return created;
  });
  await closeDb();
  console.log(isNew ? "Created the local screenshot account." : "Reset the local screenshot account.");
  console.log(`Its credentials are in ${ENV_FILE} (${EMAIL_KEY}, ${PASSWORD_KEY}).`);
} catch (error) {
  await closeDb();
  if (error instanceof DbError) fail(`${error.message} (reference ${error.errorId})`);
  fail("Something went wrong. Nothing was changed.");
}
