# CSS database

SQL migrations for CSS's own PostgreSQL database, in `migrations/`. Applied in
filename order, one transaction per file. No ORM, no migration tool: plain `psql`.

**Local development only.** Nothing here touches the cPanel server. The commands
below that drop data (`DROP SCHEMA`) must never be pointed at it.

## Versions: read this first

| | Version |
|---|---|
| Local laptop | PostgreSQL 18 |
| Production server | PostgreSQL 10.23 |

A migration that applies locally can still fail on 10, because anything added in
PostgreSQL 11 to 18 works here and does not exist there. Running these files
proves syntax and logic, **not** PG10 compatibility. The files are written to the
PG10 rules in CLAUDE.md ("Database") and were audited by reading; the only real
proof is applying them to a PostgreSQL 10 server.

(`\d` in a PG18 `psql` shows triggers as `EXECUTE FUNCTION`. The files say
`EXECUTE PROCEDURE`, which is what PG10 needs. PG18 only displays it differently.)

## One-time setup (needs a superuser, e.g. `postgres`)

```sql
CREATE ROLE css_dev LOGIN PASSWORD '<choose a local-only password>';
CREATE DATABASE css_dev OWNER css_dev;
```

Put the connection string in `.env.local` (git-ignored; check with
`git check-ignore .env.local`). Never commit it:

```
DATABASE_URL=postgresql://css_dev:<password>@127.0.0.1:5432/css_dev
```

`css_dev` has no `CREATEDB` right, so "start over" below resets the schema, not
the database.

## Apply the migrations

`psql` is at `C:\Program Files\PostgreSQL\18\bin\psql.exe`. `ON_ERROR_STOP=1`
makes it halt on the first error; a file that fails rolls back whole.

PowerShell, from the repo root:

```powershell
$env:DATABASE_URL = (Get-Content .env.local | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
foreach ($f in Get-ChildItem db\migrations\*.sql | Sort-Object Name) {
  Write-Host $f.Name
  & $psql $env:DATABASE_URL -X -q -v ON_ERROR_STOP=1 -f $f.FullName
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $($f.Name)"; break }
}
```

Git Bash, from the repo root:

```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)
PSQL="/c/Program Files/PostgreSQL/18/bin/psql.exe"
for f in db/migrations/*.sql; do
  echo "$f"
  "$PSQL" "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED: $f"; break; }
done
```

## Start over (destroys all data in the local database)

**For the owner only. Claude never runs this**: it would destroy the owner's local
login, which cannot be recreated (CLAUDE.md, "NEVER DROP OR RECREATE THE LOCAL
`public` SCHEMA"). To test a migration, use a throwaway schema in the same
database.

Run this, then apply the migrations again from the top. Never patch a
half-applied database.

PowerShell:

```powershell
& $psql $env:DATABASE_URL -X -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

Git Bash:

```bash
"$PSQL" "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

To drop the whole database instead, connect as a superuser:
`DROP DATABASE css_dev; CREATE DATABASE css_dev OWNER css_dev;`.

## One file for the server: `pg10-proof.sql`

To apply the schema on a machine that is awkward to reach, `db/pg10-proof.sql` is
all the migrations joined into a single file, verbatim and in filename order.
It is **generated, and it is not a ninth migration**: it lives in `db/`, never in
`db/migrations/`, and must never be applied on top of the migrations (it
contains them). Do not edit it.

```
npm run db:proof          # (re)generate db/pg10-proof.sql
npm run db:proof:check    # exit 1 if it is stale
```

**Regenerate it after ANY change to `db/migrations/` (a new migration, or an edit
before the first server apply), and commit both together.** A
stale proof file is worse than none: it would test something other than what you
ship. `db:proof:check` catches it.

What the generator does and does not do:

- Copies each migration's bytes unchanged. The only change to a source file is
  CRLF to LF (Git for Windows checks files out with CRLF; the repository and the
  server use LF). A lone CR, a NUL, a byte order mark or a missing final newline
  fails the build.
- Adds only a comment header, one `\set ON_ERROR_STOP on`, and one
  `\echo '>>> applying NNN_name.sql'` line before each file.
- Keeps every file's own `BEGIN`/`COMMIT`. There is no outer transaction, so a
  failing file rolls back but the files before it stay applied.
- The header lists the line range of each source file. psql reports
  `psql:pg10-proof.sql:LINE: ERROR`; the line inside the source file is
  `LINE - first + 1`.

Run it with `psql` on an EMPTY database (the `\echo` and `\set` lines are psql
commands; phpPgAdmin and most web consoles will not run them):

```
psql -X -v ON_ERROR_STOP=1 -f pg10-proof.sql "<connection>"
```

No server address, user or password belongs in the repository.

`.gitattributes` pins `db/**` to LF so a fresh checkout on Windows does not
produce CRLF SQL.

## Which file goes where: the proof file ONCE, pending files after

The cPanel server took `pg10-proof.sql` ONCE, for `001` to `009`, when its database was
empty. It must NEVER be given the proof file again: the proof file is for a FRESH, EMPTY
database and would try to create everything a second time.

Everything after that goes to the server as a **pending file**: the migrations it does not
have yet, joined the same way (verbatim, in order, LF, the same `\echo` markers and line-range
header), applied ONCE on top of what it has.

```
npm run db:pending          # (re)generate db/pending-010-016.sql
npm run db:pending:check    # exit 1 if it is stale
```

- `db/pending-010-016.sql` holds `010` to `016` (500 lines). It is GENERATED by
  `db/build-pending.mjs` (the joining is shared with the proof file, in `db/bundle.mjs`), is
  NOT a migration, never goes in `db/migrations/`, and is never applied to an empty database
  or twice.
- Apply it with `psql -X -v ON_ERROR_STOP=1 -f pending-010-016.sql "<connection>"`. Each
  migration keeps its own `BEGIN`/`COMMIT`: if one fails, the last `>>> applying` line names
  it and the ones before it are in. Then apply the REMAINING migration files one at a time;
  do not rerun the whole file.
- Proven locally: 001 to 009 then this one file gives exactly the schema the sixteen files
  give one by one (columns in order, constraints, indexes, triggers, functions, seeded rows).
- When the server has taken it, the NEXT pending file covers the migrations after `016` (change
  `FIRST`/`LAST` in `db/build-pending.mjs`; the file name follows). `db:pending` says so when a
  migration after `LAST` exists.
- Like the proof file: regenerate after any change to `db/migrations/` in its range and commit
  both together.

Locally, every route gives the same schema: one file at a time, the proof file, and 001 to 009
plus the pending file were applied and compared.

## Look at it

```bash
"$PSQL" "$DATABASE_URL" -X -c "\dt"        # the 23 tables
"$PSQL" "$DATABASE_URL" -X -c "\d visit"   # one table in full
```

## Things to know when writing code against it

- **Database errors carry row data, so they never leave the database layer.** A
  constraint violation's `DETAIL` prints the failing row, which can include
  `client_name_logged`. The rule (never log, return or show a `pg` error's
  message, detail, hint or constraint; map by constraint name to a fixed message)
  is in CLAUDE.md, "Database". Read it before writing any query code.
- **`updated_at` and `now()`.** `now()` is the time the transaction started, so
  a row inserted and updated in the same transaction has equal `created_at` and
  `updated_at`. That is normal.
- **Constraint names.** Every CHECK, UNIQUE and composite FOREIGN KEY is named in
  the migration (`<table>_<rule>_check`). A name is part of the application's
  contract with the error mapping: name every constraint you add, and change a
  name only together with the mapping.
- **Append-only tables** (`audit_log`, `visit_event`, `handover`,
  `handover_item`) reject UPDATE, DELETE and TRUNCATE with a trigger. The
  trigger does not stop the table's owner from dropping it, so on the server the
  application's role must also be granted no UPDATE, DELETE or TRUNCATE on them.
  Locally `css_dev` is the owner, so the trigger is the only protection.
- UUIDs come from `crypto.randomUUID()` in the application. There is no
  database default.
