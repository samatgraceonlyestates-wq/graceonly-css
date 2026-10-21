// Derives, from the SQL in db/migrations/, the name of every constraint and unique
// index that PostgreSQL will report in an error. Used by dbConstraints.test.ts to
// prove that dbConstraints.ts classifies ALL of them, with no live database.
//
// It reads the files; it is not used by the application. It understands the
// constructs these migrations use, and it COUNTS the keywords as it goes so that
// a construct it does not understand fails the test loudly instead of being
// silently missed (see `problems`).
//
//   explicit    CONSTRAINT name CHECK | UNIQUE | FOREIGN KEY
//   unique idx  CREATE UNIQUE INDEX name
//   primary key every CREATE TABLE t has t_pkey
//   inline FK   a column line with REFERENCES is named <table>_<column>_fkey
//
// Names are applied in file order, and DROP CONSTRAINT / DROP INDEX remove one and
// RENAME CONSTRAINT a TO b moves one, so a later migration that replaces or renames
// a constraint is handled.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DerivedKind = "unique" | "foreign_key" | "check";

export interface DerivedConstraints {
  /** name -> what kind of violation it raises. */
  names: Map<string, DerivedKind>;
  tables: string[];
  /** Things found that the derivation cannot account for. Empty means it understood everything. */
  problems: string[];
}

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

export function deriveConstraints(migrationsDir: string): DerivedConstraints {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const names = new Map<string, DerivedKind>();
  const tables: string[] = [];
  const problems: string[] = [];

  let checkKeywords = 0;
  let uniqueKeywords = 0;
  let foreignKeyKeywords = 0;
  let referencesKeywords = 0;
  let primaryKeyKeywords = 0;
  let namedChecks = 0;
  let namedUniques = 0;
  let namedForeignKeys = 0;
  let inlineForeignKeys = 0;

  for (const file of files) {
    const sql = stripComments(readFileSync(join(migrationsDir, file), "utf8"));

    checkKeywords += (sql.match(/\bCHECK\s*\(/g) ?? []).length;
    uniqueKeywords += (sql.match(/\bUNIQUE\b(?!\s+INDEX)/g) ?? []).length;
    foreignKeyKeywords += (sql.match(/\bFOREIGN\s+KEY\b/g) ?? []).length;
    referencesKeywords += (sql.match(/\bREFERENCES\b/g) ?? []).length;
    primaryKeyKeywords += (sql.match(/\bPRIMARY\s+KEY\b/g) ?? []).length;

    // Events in the order they appear in the file.
    const events = /RENAME\s+CONSTRAINT\s+([a-z0-9_]+)\s+TO\s+([a-z0-9_]+)|DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([a-z0-9_]+)|CONSTRAINT\s+([a-z0-9_]+)\s+(CHECK|UNIQUE|FOREIGN\s+KEY)|CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)|DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?([a-z0-9_]+)|CREATE\s+TABLE\s+([a-z0-9_]+)\s*\(/g;
    for (const match of sql.matchAll(events)) {
      const [, renamedFrom, renamedTo, dropped, constraint, constraintKind, uniqueIndex, droppedIndex, table] = match;
      if (renamedFrom !== undefined && renamedTo !== undefined) {
        const kind = names.get(renamedFrom);
        if (kind === undefined) problems.push(`RENAME CONSTRAINT ${renamedFrom}: no such constraint at that point.`);
        else {
          names.delete(renamedFrom);
          names.set(renamedTo, kind);
        }
      } else if (dropped !== undefined) names.delete(dropped);
      else if (droppedIndex !== undefined) names.delete(droppedIndex);
      else if (constraint !== undefined && constraintKind !== undefined) {
        const kind: DerivedKind = constraintKind.startsWith("CHECK")
          ? "check"
          : constraintKind.startsWith("UNIQUE")
            ? "unique"
            : "foreign_key";
        if (kind === "check") namedChecks += 1;
        else if (kind === "unique") namedUniques += 1;
        else namedForeignKeys += 1;
        names.set(constraint, kind);
      } else if (uniqueIndex !== undefined) names.set(uniqueIndex, "unique");
      else if (table !== undefined) {
        tables.push(table);
        names.set(`${table}_pkey`, "unique");
      }
    }

    // Inline foreign keys: a column line inside CREATE TABLE ... ); that has REFERENCES.
    for (const block of sql.matchAll(/CREATE\s+TABLE\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/g)) {
      const table = block[1];
      const body = block[2] ?? "";
      if (table === undefined) continue;
      for (const line of body.split("\n")) {
        const column = /^\s+([a-z_][a-z0-9_]*)\s+\S.*\bREFERENCES\b/.exec(line);
        if (column !== null && column[1] !== undefined && !/^\s*(CONSTRAINT|FOREIGN|CHECK|UNIQUE|PRIMARY)\b/.test(line)) {
          names.set(`${table}_${column[1]}_fkey`, "foreign_key");
          inlineForeignKeys += 1;
        }
      }
    }
  }

  if (checkKeywords !== namedChecks) {
    problems.push(`${checkKeywords} CHECK ( found but ${namedChecks} are named: every CHECK needs CONSTRAINT <name>.`);
  }
  if (uniqueKeywords !== namedUniques) {
    problems.push(`${uniqueKeywords} UNIQUE found but ${namedUniques} are named: every UNIQUE needs CONSTRAINT <name>.`);
  }
  if (foreignKeyKeywords !== namedForeignKeys) {
    problems.push(
      `${foreignKeyKeywords} FOREIGN KEY found but ${namedForeignKeys} are named: every composite foreign key needs CONSTRAINT <name>.`,
    );
  }
  if (referencesKeywords !== namedForeignKeys + inlineForeignKeys) {
    problems.push(
      `${referencesKeywords} REFERENCES found but ${namedForeignKeys + inlineForeignKeys} were accounted for (${namedForeignKeys} named, ${inlineForeignKeys} inline).`,
    );
  }
  if (primaryKeyKeywords !== tables.length) {
    problems.push(`${primaryKeyKeywords} PRIMARY KEY found for ${tables.length} tables.`);
  }
  return { names, tables, problems };
}
