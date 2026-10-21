// The guard for scripts that must only ever touch the LOCAL development database
// (scripts/screenshot-account.ts). Pure; the caller passes the URL in.
//
// It refuses anything that is not plainly a database on this machine: a missing
// URL, an unparseable one, a host other than localhost / 127.0.0.1 / ::1, and a
// URL that smuggles a different host in through the query string (the `pg`
// driver lets `?host=` override the host part). The refusal never echoes the URL:
// it carries the password.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const HOST_OVERRIDES = ["host", "hostaddr", "service"];

export class NotLocalDatabaseError extends Error {
  constructor(reason: string) {
    super(`Refusing to run: ${reason} This script only works against a database on this machine.`);
    this.name = "NotLocalDatabaseError";
  }
}

/** Returns normally only if `url` points at a database on this machine. */
export function assertLocalDatabaseUrl(url: string | undefined): void {
  if (url === undefined || url.trim() === "") throw new NotLocalDatabaseError("DATABASE_URL is not set.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new NotLocalDatabaseError("DATABASE_URL could not be read.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new NotLocalDatabaseError("DATABASE_URL is not a PostgreSQL address.");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new NotLocalDatabaseError("DATABASE_URL does not point at localhost.");
  }
  for (const key of HOST_OVERRIDES) {
    if (parsed.searchParams.has(key)) throw new NotLocalDatabaseError("DATABASE_URL overrides its host in the query string.");
  }
}
