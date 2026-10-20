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

## Look at it

```bash
"$PSQL" "$DATABASE_URL" -X -c "\dt"        # the 22 tables
"$PSQL" "$DATABASE_URL" -X -c "\d visit"   # one table in full
```

## Things to know when writing code against it

- **Database errors carry row data.** A constraint violation's `DETAIL` prints
  the failing row, which can include `client_name_logged`. Catch `pg` errors,
  map them to a fixed message, and never log or show `error.detail`,
  `error.message` for a row error, or `error.where`. (CLAUDE.md: no client data
  in an error message.)
- **`updated_at` and `now()`.** `now()` is the time the transaction started, so
  a row inserted and updated in the same transaction has equal `created_at` and
  `updated_at`. That is normal.
- **Constraint names.** Unnamed `CHECK`s get generic names (`visit_check5`).
  Map errors by constraint name in one place, and name a check when you add one
  the application needs to recognise.
- **Append-only tables** (`audit_log`, `visit_event`, `handover`,
  `handover_item`) reject UPDATE, DELETE and TRUNCATE with a trigger. The
  trigger does not stop the table's owner from dropping it, so on the server the
  application's role must also be granted no UPDATE, DELETE or TRUNCATE on them.
  Locally `css_dev` is the owner, so the trigger is the only protection.
- UUIDs come from `crypto.randomUUID()` in the application. There is no
  database default.
