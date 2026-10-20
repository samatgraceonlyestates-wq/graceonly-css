// Creates a staff account from the command line. This is the ONLY way an account
// comes into being: CSS has no signup and must never get one.
//
//   npm run staff:create -- --email grace@example.com --name "Grace Obi" \
//       --department "Front desk" --role ADMIN [--role FRONT_DESK]
//
// The PASSWORD is typed at a prompt (twice, nothing echoed). It is never an
// argument: an argument lands in the shell history and in the process list for
// anyone on the machine to read, so this script refuses --password outright. It
// will not read the password from a pipe or a file either, only from a terminal.
// The account is created with must_change_password, so the first sign-in forces
// a new password.
//
// Works on the server: it needs DATABASE_URL in the environment (or .env.local)
// and an interactive terminal (SSH or the cPanel terminal). From Windows run it
// in PowerShell or Windows Terminal; Git Bash's terminal is not a real TTY to
// Node and the script will say so.
import { parseArgs } from "node:util";
import { validateNewPassword } from "../src/lib/authPolicy.ts";
import { DbError, closeDb } from "../src/lib/db.ts";
import { HiddenInput } from "../src/lib/hiddenPrompt.ts";
import { ROLE_CODES, StaffInputError, createStaffAccount } from "../src/lib/staffAdmin.ts";

const USAGE = `Usage: npm run staff:create -- --email <email> --name "<full name>" --department "<department>" --role <ROLE> [--role <ROLE> ...]
Roles: ${ROLE_CODES.join(", ")}
The password is asked for at a prompt. It cannot be given as an argument.`;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

// Refuse anything that looks like an attempt to pass the password on the command
// line, WITHOUT echoing the argument (it may be the password).
for (const argument of process.argv.slice(2)) {
  if (/^--?(p|pw|pass|passwd|password)(=|$)/i.test(argument)) {
    fail("The password cannot be given as an argument: it would be kept in your shell history and visible in the process list. It is asked for at a prompt.\n\n" + USAGE, 2);
  }
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      department: { type: "string" },
      role: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
} catch {
  // The parser's own message can quote the argument; say it ourselves.
  fail("Unrecognised or malformed arguments.\n\n" + USAGE, 2);
}

const { email, name, department, role, help } = parsed.values;
if (help) fail(USAGE, 0);
if (!email || !name || !department || !role || role.length === 0) fail("Missing arguments.\n\n" + USAGE, 2);

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  fail(
    "This needs an interactive terminal: the password is typed at a prompt, never piped or passed as an argument.\n" +
      "On Windows use PowerShell or Windows Terminal (Git Bash's terminal does not count as a TTY to Node).",
    2,
  );
}

/** Reads one line from the terminal with nothing echoed. Returns null if cancelled. */
function readHidden(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = new HiddenInput();
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const finish = (value: string | null) => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (chunk: string) => {
      const result = input.feed(chunk);
      if (result.cancelled) finish(null);
      else if (result.done) finish(input.take());
    };
    process.stdin.on("data", onData);
  });
}

async function askForPassword(): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const first = await readHidden("Password: ");
    if (first === null) fail("Cancelled. Nothing was created.");
    const problem = validateNewPassword(first);
    if (problem !== null) {
      console.error(problem);
      continue;
    }
    const second = await readHidden("Type it again: ");
    if (second === null) fail("Cancelled. Nothing was created.");
    if (first !== second) {
      console.error("The two did not match.");
      continue;
    }
    return first;
  }
  return fail("Too many attempts. Nothing was created.");
}

try {
  const password = await askForPassword();
  const created = await createStaffAccount({ email, fullName: name, department, roles: role, password });
  console.log(`Created ${created.email} (${created.id}) with ${created.roles.join(", ")}.`);
  console.log("They must choose a new password at their first sign-in.");
  await closeDb();
} catch (error) {
  await closeDb();
  if (error instanceof StaffInputError) fail(error.message, 2);
  // A DbError's message is fixed text, safe to print, and it comes with a
  // reference that matches a line in the log.
  if (error instanceof DbError) fail(`${error.message} (reference ${error.errorId})`);
  fail("Something went wrong. Nothing was created.");
}
