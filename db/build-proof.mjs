// Builds db/pg10-proof.sql: the migrations in db/migrations/, joined in filename
// order, so ONE file can be carried to a PostgreSQL 10 server and applied there.
//
//   node db/build-proof.mjs            write db/pg10-proof.sql
//   node db/build-proof.mjs --check    exit 1 if the file on disk is stale
//
// The migration text is copied byte for byte. The only change made to a source
// file's bytes is CRLF -> LF (git for Windows checks files out with CRLF while
// the repository stores LF, and the server is Linux). A lone CR, a NUL, a byte
// order mark or a missing final newline fails the build rather than being
// quietly repaired. Nothing is parsed, retyped or reformatted. Added around the
// copied text: a comment header, one `\set ON_ERROR_STOP on`, and one `\echo`
// line before each file.
//
// No dependencies: node:fs and node:path only.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "migrations");
const outFile = join(here, "pg10-proof.sql");
const outName = "db/pg10-proof.sql";

function fail(message) {
  console.error(`build-proof: ${message}`);
  process.exit(1);
}

// "latin1" maps every byte to one character and back, so the round trip is exact
// whatever the file contains (UTF-8 in a comment included).
function readMigration(name) {
  const raw = readFileSync(join(migrationsDir, name));
  if (raw.includes(0)) fail(`${name} contains a NUL byte`);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) fail(`${name} starts with a byte order mark`);
  const text = raw.toString("latin1").replace(/\r\n/g, "\n");
  if (text.includes("\r")) fail(`${name} contains a lone carriage return`);
  if (!text.endsWith("\n")) fail(`${name} does not end with a newline`);
  return text;
}

const names = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort();
if (names.length === 0) fail("no .sql files in db/migrations/");
for (const name of names) {
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) fail(`unexpected migration file name: ${name}`);
}
const numbers = names.map((n) => n.slice(0, 3));
if (new Set(numbers).size !== numbers.length) fail("two migrations share a number");

const bodies = names.map(readMigration);
const countLines = (text) => text.split("\n").length - 1;

// The header lists where each file starts, and its own length does not depend on
// those numbers, so build it once with placeholders to learn the length.
function header(ranges) {
  const lines = [
    "-- ============================================================================",
    "-- db/pg10-proof.sql  --  GENERATED FILE.  THIS IS NOT A MIGRATION.",
    "--",
    "-- The migrations in db/migrations/, joined in filename order, so one file can be",
    "-- carried to a PostgreSQL 10 server and applied there. It CONTAINS the",
    "-- migrations: never put it in db/migrations/, and never apply it in addition to",
    "-- them (the second CREATE FUNCTION would fail).",
    "--",
    "-- Do not edit it.  Regenerate:  node db/build-proof.mjs",
    "--                  Is it stale: node db/build-proof.mjs --check",
    "-- A stale proof file is worse than none.",
    "--",
    "-- Run it on an EMPTY database, with psql (the \\echo and \\set lines are psql",
    "-- commands and other clients will not understand them):",
    "--   psql -X -v ON_ERROR_STOP=1 -f pg10-proof.sql <connection>",
    "-- Each migration keeps its own BEGIN/COMMIT; there is no outer transaction. If a",
    "-- file fails it rolls back, but the files before it stay applied. Drop the",
    "-- schema and start again; never patch a half-applied database.",
    "--",
    "-- psql reports  psql:pg10-proof.sql:LINE: ERROR: ...  Find LINE below. The line",
    "-- inside the source file is  LINE - first + 1.  Lines are counted in THIS file.",
    "--",
    ...ranges.map(
      ({ name, first, last }) =>
        `--   ${name.padEnd(32)} lines ${String(first).padStart(5)} - ${String(last).padStart(5)}`,
    ),
    "-- ============================================================================",
    "\\set ON_ERROR_STOP on",
  ];
  return lines.join("\n") + "\n";
}

const placeholder = names.map((name) => ({ name, first: 0, last: 0 }));
let cursor = countLines(header(placeholder));
const ranges = [];
for (let i = 0; i < names.length; i += 1) {
  cursor += 1; // the \echo line
  const first = cursor + 1;
  const length = countLines(bodies[i]);
  ranges.push({ name: names[i], first, last: first + length - 1 });
  cursor += length;
}

let out = header(ranges);
for (let i = 0; i < names.length; i += 1) {
  out += `\\echo '>>> applying ${names[i]}'\n`;
  out += bodies[i];
}
const bytes = Buffer.from(out, "latin1");

if (process.argv.includes("--check")) {
  if (!existsSync(outFile)) fail(`${outName} does not exist; run: node db/build-proof.mjs`);
  if (!readFileSync(outFile).equals(bytes)) {
    fail(`${outName} is STALE: a migration changed. Regenerate it: node db/build-proof.mjs`);
  }
  console.log(`${outName} is current (${countLines(out)} lines, ${bytes.length} bytes).`);
} else {
  writeFileSync(outFile, bytes);
  console.log(`wrote ${relative(process.cwd(), outFile) || outName}: ${countLines(out)} lines, ${bytes.length} bytes`);
  for (const r of ranges) console.log(`  ${r.name.padEnd(24)} lines ${r.first}-${r.last}`);
}
