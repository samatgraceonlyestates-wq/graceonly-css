// The ONE implementation that joins migrations into a single file for psql, used by
// db/build-proof.mjs (all of them, for an EMPTY database) and db/build-pending.mjs (the ones
// a server that already has the earlier ones still needs). Neither output is a migration.
//
// The migration text is copied byte for byte. The only change made to a source file's bytes
// is CRLF -> LF (git for Windows checks files out with CRLF while the repository stores LF,
// and the server is Linux). A lone CR, a NUL, a byte order mark or a missing final newline
// fails the build rather than being quietly repaired. Nothing is parsed, retyped or
// reformatted. Added around the copied text: a comment header (which lists each file's line
// range, so `psql:<file>:LINE: ERROR` maps back to a source file), one
// `\set ON_ERROR_STOP on`, and one `\echo '>>> applying NNN_name.sql'` line before each file.
//
// No dependencies: node:fs and node:path only.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DB_DIR = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(DB_DIR, "migrations");

export function fail(tool, message) {
  console.error(`${tool}: ${message}`);
  process.exit(1);
}

// "latin1" maps every byte to one character and back, so the round trip is exact
// whatever the file contains (UTF-8 in a comment included).
export function readMigration(tool, name) {
  const raw = readFileSync(join(MIGRATIONS_DIR, name));
  if (raw.includes(0)) fail(tool, `${name} contains a NUL byte`);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) fail(tool, `${name} starts with a byte order mark`);
  const text = raw.toString("latin1").replace(/\r\n/g, "\n");
  if (text.includes("\r")) fail(tool, `${name} contains a lone carriage return`);
  if (!text.endsWith("\n")) fail(tool, `${name} does not end with a newline`);
  return text;
}

/** Every migration file name, in filename order, checked for shape and unique numbers. */
export function migrationNames(tool) {
  const names = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort();
  if (names.length === 0) fail(tool, "no .sql files in db/migrations/");
  for (const name of names) {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) fail(tool, `unexpected migration file name: ${name}`);
  }
  const numbers = names.map((n) => n.slice(0, 3));
  if (new Set(numbers).size !== numbers.length) fail(tool, "two migrations share a number");
  return names;
}

export const countLines = (text) => text.split("\n").length - 1;

/** The header's line-range list: one line per file. */
export function rangeLines(ranges) {
  return ranges.map(({ name, first, last }) => `--   ${name.padEnd(32)} lines ${String(first).padStart(5)} - ${String(last).padStart(5)}`);
}

/**
 * Joins `names` into one file. `header(ranges)` returns the header's lines (its length must
 * not depend on the numbers in `ranges`: it is built once with placeholders to learn it).
 * Returns the bytes and each file's line range in the output.
 */
export function bundle(tool, names, header) {
  const bodies = names.map((name) => readMigration(tool, name));
  const render = (ranges) => [...header(ranges), "\\set ON_ERROR_STOP on"].join("\n") + "\n";
  let cursor = countLines(render(names.map((name) => ({ name, first: 0, last: 0 }))));
  const ranges = [];
  for (let i = 0; i < names.length; i += 1) {
    cursor += 1; // the \echo line
    const first = cursor + 1;
    const length = countLines(bodies[i]);
    ranges.push({ name: names[i], first, last: first + length - 1 });
    cursor += length;
  }
  let out = render(ranges);
  for (let i = 0; i < names.length; i += 1) {
    out += `\\echo '>>> applying ${names[i]}'\n`;
    out += bodies[i];
  }
  return { bytes: Buffer.from(out, "latin1"), ranges, lines: countLines(out) };
}

/** Writes the file, or with --check exits 1 if the file on disk differs. */
export function writeOrCheck(tool, { outFile, outName, regenerate }, result) {
  if (process.argv.includes("--check")) {
    if (!existsSync(outFile)) fail(tool, `${outName} does not exist; run: ${regenerate}`);
    if (!readFileSync(outFile).equals(result.bytes)) fail(tool, `${outName} is STALE: a migration changed. Regenerate it: ${regenerate}`);
    console.log(`${outName} is current (${result.lines} lines, ${result.bytes.length} bytes).`);
  } else {
    writeFileSync(outFile, result.bytes);
    console.log(`wrote ${outName}: ${result.lines} lines, ${result.bytes.length} bytes`);
    for (const r of result.ranges) console.log(`  ${r.name.padEnd(36)} lines ${r.first}-${r.last}`);
  }
}
