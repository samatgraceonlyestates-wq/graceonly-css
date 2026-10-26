// Builds db/pending-<FIRST>-<LAST>.sql: the migrations the cPanel server does NOT have yet,
// joined in filename order into ONE file, for a database that ALREADY HAS 001 to FIRST-1. It is
// NOT a migration and NOT the proof file: it lives in db/, never in db/migrations/, and is
// applied ONCE, on top of what the server has, never on an empty database and never twice.
//
// What the server has taken so far (TAKEN below): db/pg10-proof.sql for 001-009, then
// db/pending-010-016.sql, then db/pending-017-017.sql. Those files are now HISTORY: they stay in
// the repo as what was applied (the migrations are append-only, so they never change) and are
// not applied again.
//
//   node db/build-pending.mjs            write it  (npm run db:pending)
//   node db/build-pending.mjs --check    exit 1 if it is stale  (npm run db:pending:check)
//
// Re-runnable: it always rebuilds the whole file from db/migrations/ (the same joining as the
// proof file: db/bundle.mjs). FIRST and LAST name the range. When the server has taken this
// file, the next pending file covers the migrations after LAST (a new range and a new name);
// this one is then history and is not applied again.
import { join } from "node:path";
import { bundle, DB_DIR, fail, migrationNames, rangeLines, writeOrCheck } from "./bundle.mjs";

const TOOL = "build-pending";
const FIRST = 18;
const LAST = 18;
// What the server already took, in order, so the header can say it.
const TAKEN = ["db/pg10-proof.sql (001-009)", "db/pending-010-016.sql (010-016)", "db/pending-017-017.sql (017)"];

const pad = (n) => String(n).padStart(3, "0");
const OUT_NAME = `pending-${pad(FIRST)}-${pad(LAST)}.sql`;

const all = migrationNames(TOOL);
const names = all.filter((name) => {
  const n = Number(name.slice(0, 3));
  return n >= FIRST && n <= LAST;
});
// Every number in the range must be there, once: a gap would ship an incomplete file.
for (let n = FIRST; n <= LAST; n += 1) {
  if (!names.some((name) => name.startsWith(pad(n)))) fail(TOOL, `migration ${pad(n)} is missing from db/migrations/`);
}
const after = all.filter((name) => Number(name.slice(0, 3)) > LAST);

const header = (ranges) => [
  "-- ============================================================================",
  `-- db/${OUT_NAME}  --  GENERATED FILE.  THIS IS NOT A MIGRATION.`,
  "--",
  `-- Migrations ${pad(FIRST)} to ${pad(LAST)} from db/migrations/, verbatim and in filename order, as ONE`,
  `-- file for the cPanel server, which ALREADY HAS 001 to ${pad(FIRST - 1)} (it took, in order:`,
  ...TAKEN.map((taken) => `--   ${taken}`),
  `-- ). Apply it ONCE, on top of 001-${pad(FIRST - 1)}. Never on an empty database`,
  "-- (use pg10-proof.sql there), never twice, and never together with the separate",
  "-- migration files it contains. It is not the proof file and never goes in",
  "-- db/migrations/.",
  "--",
  "-- Do not edit it.  Regenerate:  node db/build-pending.mjs   (npm run db:pending)",
  "--                  Is it stale: node db/build-pending.mjs --check",
  "--",
  "-- Run it with psql (the \\echo and \\set lines are psql commands):",
  `--   psql -X -v ON_ERROR_STOP=1 -f ${OUT_NAME} <connection>`,
  "-- Each migration keeps its own BEGIN/COMMIT; there is no outer transaction. If one",
  "-- fails it rolls back, but the ones before it stay applied: the last",
  "-- '>>> applying' line printed names the file that failed, and everything before it",
  "-- is in. Fix the cause and apply the REMAINING migration files one at a time; do not",
  "-- run this whole file again.",
  "--",
  `-- psql reports  psql:${OUT_NAME}:LINE: ERROR: ...  Find LINE below. The line`,
  "-- inside the source file is  LINE - first + 1.  Lines are counted in THIS file.",
  "--",
  ...rangeLines(ranges),
  "-- ============================================================================",
];

writeOrCheck(TOOL, { outFile: join(DB_DIR, OUT_NAME), outName: `db/${OUT_NAME}`, regenerate: "node db/build-pending.mjs" }, bundle(TOOL, names, header));
if (after.length > 0) {
  console.log(`NOTE: ${after.join(", ")} came after ${pad(LAST)} and is NOT in db/${OUT_NAME}: the server needs a new pending file for it.`);
}
