# Deploying CSS

What putting CSS (the Customer Support System) on the cPanel server needs. Written from the
code as it stands at migration 016. The deploy itself is done outside the development
sessions; nothing here has been run on the server. **Section 7 lists what is NOT known: read
it before starting.**

CSS is a Next.js 16 app (`next build`, then `next start`), Node 22, PostgreSQL through the
plain `pg` driver. It is a separate app, repo and database from the client portal and talks to
the portal only over its HTTPS API.

---

## 1. Environment variables

Four variables are read by the running app. Nothing else is needed at run time.

| Variable | Required | What it is for | Shape |
|---|---|---|---|
| `DATABASE_URL` | yes | CSS's own PostgreSQL database. Read when the first query runs (not at start-up), so a wrong value shows up as a failed sign-in, not as a crash on boot. Never logged. | `postgresql://USER:PASSWORD@HOST:5432/DBNAME` |
| `CSS_PORTAL_BASE_URL` | yes, for anything that reads the portal | The portal's API base. Must be `https:` (plain `http:` is refused except for localhost). | `https://portal.graceonlyestates.com` (confirm the exact base path with the portal) |
| `CSS_PORTAL_SERVICE_KEY` | yes, with the above | Sent as `X-Service-Key` on every portal call. | `<id>.<secret>` |
| `NODE_ENV` | must be `production` | Turns on the `Secure` flag on the session cookie, and Next's production mode. | `production` |

Notes:

- **The portal's key-generation script calls the same value `CSS_PORTAL_KEY`.** CSS reads
  `CSS_PORTAL_SERVICE_KEY`. Copy the VALUE under CSS's name. Mixing the names up has already
  cost a debugging round.
- **Sign-in does not touch the portal.** If the portal variables are wrong, staff can still
  sign in and use attendance; client search, client summaries and documents fail with a
  fixed message.
- **Not for the server:** `CSS_SHOT_EMAIL`, `CSS_SHOT_PASSWORD` and `SHOTS_DATABASE_URL` belong
  to the local screenshot tooling only. The screenshot account script refuses any database
  that is not on localhost; never create that account on the server.
- `PORT` is whatever the host's launcher gives `next start`; CSS does not read it itself.

### The cPanel launcher STRIPS DOUBLE QUOTES from environment variables

This is known, from the portal: the cPanel Node.js launcher removes `"` characters from the
values set in its environment-variable screen. The portal worked around it with a
`.env.production.local` file. For CSS:

- **None of CSS's four values needs a quote**, with one possible exception: the database
  PASSWORD inside `DATABASE_URL`. A password with `"` (or `@`, `:`, `/`, `#`, `%`, `?`, a space)
  must be **percent-encoded** in the URL anyway (`"` is `%22`, `@` is `%40`, `%` is `%25`).
  Percent-encoded, it contains no quote and survives the launcher. Simplest of all: give the
  CSS database user a password made of letters and digits only.
- If a quote cannot be avoided, use a `.env.production.local` file in the app's root (Next loads
  it in production). `.env*` files are git-ignored, so it is created on the server by hand;
  make it readable by the app's user only.
- **Do not set a variable in BOTH places.** Next does not overwrite a variable that already
  exists in the process environment: a mangled value from the launcher WINS over the correct
  one in the file. One source per variable.
- Other quotes in CSS are not environment variables and are unaffected: the `setting` table
  stores JSON (`'"09:15"'`) inside the database.

### The command-line scripts read a different file

`npm run staff:create`, `npm run portal:health` and `npm run portal:try` run plain Node with
`--env-file-if-exists=.env.local`. They read **`.env.local`, not `.env.production.local`**, and
not the launcher's screen. On the server, run them with the variables exported in the shell
for that one command, or with a `.env.local` that holds only what that script needs. They also
need **Node 22.9 or later** (`--env-file-if-exists` and `--experimental-strip-types`).

---

## 2. The database

### What the server has, and what it still needs

The cPanel server is reported to have **001 to 009** applied. It needs **010 to 016**, applied
**one file at a time, in order**, each in its own transaction (each file has its own
`BEGIN`/`COMMIT`):

| File | What it does | Precondition |
|---|---|---|
| `010_roster_movements_backdating.sql` | roster people (no password), the `movement` table, `backdate_reason`; makes `entered_by` NOT NULL | **No `attendance_record` row may exist** (the NOT NULL would fail loudly, by design). Nothing has written one on the server. |
| `011_entered_by_per_event.sql` | renames `entered_by` to `clock_in_entered_by`; adds `clock_out_entered_by`, `movement.returned_recorded_by` | 010 |
| `012_movement_entered_by_names.sql` | renames movement's author columns to `left_entered_by` / `returned_entered_by` | 011 |
| `013_signout_missing.sql` | the "never signed out" state; rebuilds `attendance_one_open_shift_key` | 012 |
| `014_corrections.sql` | `corrected_at` / `corrected_by` / `voided_at` on records; rebuilds the open-shift index | 013 |
| `015_movement_corrections.sql` | the same for `movement`; rebuilds `movement_one_open_key` | 014 |
| `016_late_threshold_snapshot.sql` | `attendance_record.late_after_local`: the late threshold copied onto each record | 015; reads the `attendance.late_after_local` setting row |

Apply with `psql -X -v ON_ERROR_STOP=1 -f <file>` against the CSS database, as the database's
owner. **Do NOT use `db/pg10-proof.sql` on the server**: it is every migration joined, for an
EMPTY database, and would try to create everything again.

### Not verified on PostgreSQL 10

The server runs **PostgreSQL 10.23**. Every migration has been run on PostgreSQL 18 locally
(from the top, and old-then-new), never on 10. They were written for 10 (no generated columns,
no ENUMs, `EXECUTE PROCEDURE`, no `gen_random_uuid()`, no extensions), but that is a promise,
not a test. 010 and 013 to 015 drop and re-create indexes and constraints, the parts most
likely to behave differently. `db/pg10-proof.sql` exists to prove all of it on a throwaway
PG10 database first; that has not been done. PostgreSQL 10 is end of life.

### Before a first run

1. **Migrations 010 to 016 applied** (above).
2. **The application's database role.** The append-only tables (`audit_log`, `visit_event`,
   `handover`, `handover_item`) are protected by triggers, AND the role the app connects as
   must have NO `UPDATE`, `DELETE` or `TRUNCATE` on them. Whether cPanel lets you create a
   second role (owner for migrations, a narrower one for the app) is not known; if the app
   connects as the owner, the triggers are the only guard.
3. **The setting rows** come from migration 005 (`attendance.late_after_local` = `"09:15"` and
   the others). Check they are there; the register treats a missing or unreadable threshold as
   "late: unknown", never as a default.
4. **The first account.** There is no signup. On the server, in a real terminal (the cPanel
   Terminal; the script refuses a pipe and never takes the password as an argument):
   `npm run staff:create -- --email <email> --name "<full name>" --department "<dept>" --role ADMIN`
   The password is typed twice at a prompt. The account must change it at first sign-in.
   The front-desk accounts are made the same way with `--role FRONT_DESK`.
5. **The portal key** issued by the portal and set as `CSS_PORTAL_SERVICE_KEY`; then
   `npm run portal:health` (one read-only GET, prints no key) should answer.
6. **HTTPS.** See below: without it nobody can stay signed in.

---

## 3. Building and starting

- `npm ci` (with dev dependencies: the build needs TypeScript), then `npm run build`, then the
  app is started with `next start` (`npm start`). There is no custom server file and no
  `output: "standalone"`.
- **Node 22** (`engines: >=22 <23`). Node 24 has been used locally without trouble, but 22 is
  what is declared.
- The build writes `.next/`. Every code change needs a rebuild and a restart.
- `@playwright/test` is a dev dependency for the local screenshot tooling; it does not download
  browsers on install and is never run on the server.

---

## 4. What would break, or behave differently, on a shared host

Known from the code:

- **The session cookie is `Secure` in production.** A browser drops a `Secure` cookie that
  arrives over plain `http`: sign-in would "succeed" and land back on the sign-in page, with no
  error. The site MUST be served over HTTPS (and the address used must be the https one).
- **The database pool is deliberately small:** at most 5 connections per Node process, 5 s to
  connect, 10 s idle, and every session sets `statement_timeout` and
  `idle_in_transaction_session_timeout` to 15 s. On shared PostgreSQL, `max_connections` is
  server-wide. If the launcher runs several processes, multiply 5 by that number.
- **The `statement_timeout` settings are sent when each connection opens.** A connection pooler
  in front of PostgreSQL (PgBouncer in transaction mode) can refuse such start-up options; if
  connections fail at once with a parameter error, this is why.
- **Rate limits live in process memory.** The per-IP sign-in limit (20 failures / 15 minutes)
  and the unknown-address limiter are per process: several processes each keep their own, and
  a restart (or the launcher putting an idle app to sleep) clears them. The per-ACCOUNT lock (5
  failures, 15 minutes) is in the database and holds regardless.
- **The client address comes from the LAST `X-Forwarded-For` entry.** If the host's front end
  does not set that header, or sets it differently, every request may appear to come from one
  address: then the per-IP limit applies to everyone together, and one person's bad guesses
  slow everyone's sign-in.
- **Password hashing is memory-heavy on purpose:** scrypt needs about 34 MB per sign-in, and at
  most 2 run at once (more wait, then get "busy"). A host memory limit near Next's own use
  plus 70 MB could kill the process during sign-in.
- **Sleeping apps.** If the launcher stops the app when idle, the first request after a pause
  is slow, and the in-memory limits are reset.
- **Time zone.** Every day boundary is computed as Africa/Lagos in the application (Node's
  built-in time zone data). The server's own time zone does not matter, and must not be
  "fixed" by changing database queries.
- **Logs.** The app logs a failed sign-in's reason and, for a real account, its staff id;
  database failures log a SQLSTATE, constraint name, table and an error id, never data. Where
  the launcher puts stdout and stderr is not known.

---

## 5. Checks after the first deploy

1. Open the site over https; sign in with the first account; change the password when asked.
2. `/attendance` loads (the board, empty). `/attendance/register` loads for the admin.
3. Enter one arrival on `/attendance/arrivals`, clock it out, correct it, and see it marked
   "Corrected" on the board and in the register.
4. A client search on `/visits/new` (needs the portal variables).
5. Sign out, and confirm the session is gone (the back button does not get you in).

---

## 6. Things deliberately NOT on the server

- The screenshot account and all `scripts/shots-*` tooling (local only, refuse non-local).
- `db/pg10-proof.sql` (for an empty PG10 database, not this one).
- Any `DROP`/`CREATE SCHEMA`: the README's "Start over" is for a local database only.

---

## 7. What is NOT known (find out before deploying)

- **How cPanel starts this app.** cPanel's "Setup Node.js App" runs apps through Phusion
  Passenger with an "application startup file". CSS has none (it relies on `next start`). How
  the portal (also Next.js, presumably) solved this, and whether that file can be copied, is
  not known here. The quote-stripping "launcher" is that same mechanism.
- **Which Node versions the host offers**, and whether 22.9+ is among them (the scripts need it).
- **Whether `npm run build` fits in the host's memory and process limits.** If not, the build
  has to happen elsewhere and `.next/` be uploaded, which is not set up.
- **Whether the launcher runs one process or several**, and whether it sleeps an idle app
  (affects the connection count and the in-memory limits above).
- **Whether there is a connection pooler** in front of PostgreSQL, and the server's
  `max_connections` and how much of it other databases use.
- **Whether a second, narrower database role can be created** for the app (section 2, step 2).
- **What `X-Forwarded-For` looks like** behind the host's front end.
- **That migrations 001 to 009 on the server are exactly the files in this repo.** It is
  reported; it has not been compared. A quick check before 010: `\d attendance_record` should
  show `entered_by`, `clock_in_device_id`, `clock_in_device_kind` and no `backdate_reason`.
- **The portal's exact API base URL** for `CSS_PORTAL_BASE_URL`, and whether the portal's
  service-key record for CSS exists on the live portal.
- **Whether HTTPS is set up** for the CSS domain or subdomain, and what that domain is.
- **Backups.** Visitor records are kept permanently (CLAUDE.md); nothing here sets up or checks
  a backup of the CSS database.
