// Builds db/pg10-proof.sql: the migrations in db/migrations/, joined in filename
// order, so ONE file can be carried to a PostgreSQL 10 server and applied there.
//
//   node db/build-proof.mjs            write db/pg10-proof.sql
//   node db/build-proof.mjs --check    exit 1 if the file on disk is stale
//
// The joining (byte-for-byte copy, CRLF -> LF only, the header, the \echo markers) is
// db/bundle.mjs, shared with db/build-pending.mjs.
import { join } from "node:path";
import { bundle, DB_DIR, migrationNames, rangeLines, writeOrCheck } from "./bundle.mjs";

const TOOL = "build-proof";
const names = migrationNames(TOOL);

const header = (ranges) => [
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
  ...rangeLines(ranges),
  "-- ============================================================================",
];

writeOrCheck(
  TOOL,
  { outFile: join(DB_DIR, "pg10-proof.sql"), outName: "db/pg10-proof.sql", regenerate: "node db/build-proof.mjs" },
  bundle(TOOL, names, header),
);
