// Creating a staff account. There is NO signup in CSS and there must never be
// one: accounts are made by an administrator from the command line
// (scripts/create-staff.ts), never through the web app.
//
// SERVER-ONLY (db.ts). The account is created with must_change_password = true,
// so the first sign-in is forced through the change-password screen and the
// password the administrator typed at the prompt does not stay in use.
//
// The password is hashed here and never stored, logged or returned. Errors raised
// by this file are fixed text and never contain it.
import { randomUUID } from "node:crypto";
import { looksLikeEmail, normaliseEmail, validateNewPassword } from "./authPolicy.ts";
import { sql, transaction as defaultTransaction, type Tx } from "./db.ts";
import { passwords as defaultPasswords, type PasswordHasher } from "./password.ts";

export const ROLE_CODES = ["FRONT_DESK", "LEGAL", "ADMIN", "SUPER_ADMIN"] as const;
export type RoleCodeInput = (typeof ROLE_CODES)[number];

/** Something wrong with what the administrator typed. The message is safe to print. */
export class StaffInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffInputError";
  }
}

export interface NewStaff {
  email: string;
  fullName: string;
  department: string;
  roles: readonly string[];
  password: string;
}

export interface StaffAdminDeps {
  hasher?: PasswordHasher;
  transaction?: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
  newId?: () => string;
}

export async function createStaffAccount(
  input: NewStaff,
  deps: StaffAdminDeps = {},
): Promise<{ id: string; email: string; roles: string[] }> {
  const hasher = deps.hasher ?? defaultPasswords;
  const run = deps.transaction ?? defaultTransaction;
  const newId = deps.newId ?? randomUUID;

  const email = normaliseEmail(input.email);
  if (!looksLikeEmail(email)) throw new StaffInputError("That is not a valid email address.");
  const fullName = input.fullName.trim();
  if (fullName.length === 0) throw new StaffInputError("The full name cannot be empty.");
  const department = input.department.trim();
  if (department.length === 0) throw new StaffInputError("The department cannot be empty.");

  const roles = [...new Set(input.roles.map((role) => role.trim().toUpperCase()))];
  if (roles.length === 0) throw new StaffInputError(`Give at least one role: ${ROLE_CODES.join(", ")}.`);
  const unknown = roles.filter((role) => !(ROLE_CODES as readonly string[]).includes(role));
  if (unknown.length > 0) throw new StaffInputError(`Unknown role. Use: ${ROLE_CODES.join(", ")}.`);

  const weak = validateNewPassword(input.password);
  if (weak !== null) throw new StaffInputError(weak);

  const hash = await hasher.hash(input.password);
  const id = newId();

  await run(async (tx) => {
    await tx.query(sql`
      INSERT INTO staff (id, email, full_name, department, password_hash, must_change_password)
      VALUES (${id}, ${email}, ${fullName}, ${department}, ${hash}, true)`);
    for (const role of roles) {
      await tx.query(sql`INSERT INTO staff_role (staff_id, role_code) VALUES (${id}, ${role})`);
    }
    // The audit entry carries ids and non-sensitive facts only: no email, no hash.
    await tx.query(sql`
      INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, after)
      VALUES (NULL, ${"staff"}, ${id}, ${"CREATE"},
              ${JSON.stringify({ department, roles, must_change_password: true, via: "create-staff script" })}::jsonb)`);
  });

  return { id, email, roles };
}
