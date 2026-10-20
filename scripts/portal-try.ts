// npm run portal:try -- <command> [argument]
//   health
//   search <name>
//   client <clientId>
//   documents <clientId>
//   release <clientId>
// Read-only: every command is a single GET through src/lib/portal.ts. Prints
// the status and body only; the key is never printed.
import {
  getClientDocuments,
  getClientSummary,
  getHealth,
  getReleaseCheck,
  searchClients,
  type PortalResult,
} from "../src/lib/portal.ts";

const [command, ...rest] = process.argv.slice(2);
const argument = rest.join(" ").trim();

const USAGE = "Usage: npm run portal:try -- health | search <name> | client <id> | documents <id> | release <id>";

async function run(): Promise<PortalResult<unknown> | null> {
  if (command === "health") return getHealth();
  if (!argument) return null;
  switch (command) {
    case "search":
      return searchClients(argument);
    case "client":
      return getClientSummary(argument);
    case "documents":
      return getClientDocuments(argument);
    case "release":
      return getReleaseCheck(argument);
    default:
      return null;
  }
}

const result = await run();

if (result === null) {
  console.error(USAGE);
  process.exitCode = 2;
} else if (result.ok) {
  console.log(`${command} -> ${result.status} OK${result.requestId ? ` (requestId ${result.requestId})` : ""}`);
  console.log(JSON.stringify(result.data, null, 2));
} else {
  const { error } = result;
  console.error(`${command} -> FAILED (${error.kind}${error.status === null ? "" : `, HTTP ${error.status}`})`);
  console.error(error.message);
  if (error.code) console.error(`code ${error.code}`);
  if (error.requestId) console.error(`requestId ${error.requestId}`);
  if (error.retryAfterSeconds !== null) console.error(`Retry after ${error.retryAfterSeconds}s`);
  if (error.body !== null) console.error(JSON.stringify(error.body, null, 2));
  process.exitCode = 1;
}
