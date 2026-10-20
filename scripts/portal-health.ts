// npm run portal:health: GET /health through src/lib/portal.ts and print the
// result. Prints status and body only; the key is never printed.
import { getHealth } from "../src/lib/portal.ts";

const result = await getHealth();

if (result.ok) {
  console.log(`GET /health -> ${result.status} OK`);
  console.log(JSON.stringify(result.data, null, 2));
} else {
  const { error } = result;
  console.error(`GET /health -> FAILED (${error.kind}${error.status === null ? "" : `, HTTP ${error.status}`})`);
  console.error(error.message);
  if (error.code) console.error(`code ${error.code}`);
  if (error.retryAfterSeconds !== null) console.error(`Retry after ${error.retryAfterSeconds}s`);
  if (error.body !== null) console.error(JSON.stringify(error.body, null, 2));
  process.exitCode = 1;
}
