# Deploying CSS

What putting CSS (the Customer Support System) on the cPanel server needs. Written from the
code as it stands at migration 017. The deploy itself is done outside the development
sessions; nothing here has been run on the server. **Section 7 lists what is NOT known: read
it before starting.**

CSS is a Next.js 16 app built as **standalone output** and started by a startup file,
`app.js` (cPanel cannot run `next start`), on Node 22, with PostgreSQL through the plain `pg`
driver. It goes live at **https://frontdesk.graceonlyestates.com**. On day one only the owner
has a login. It is a separate app, repo and database from the client portal and talks to the
portal only over its HTTPS API.

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
- `PORT` and `HOST` are read by the startup file `app.js` (section 3): the port the launcher
  gives, and optionally the address to listen on (default `0.0.0.0`). Leave them to the
  launcher unless it says otherwise. `HOSTNAME` is ignored on purpose.

### The cPanel launcher STRIPS DOUBLE QUOTES from environment variables

This is known, from the portal: the cPanel Node.js launcher removes `"` characters from the
values set in its environment-variable screen. The portal worked around it with a
`.env.production.local` file. For CSS:

- **None of CSS's four values needs a quote**, with one possible exception: the database
  PASSWORD inside `DATABASE_URL`. A password with `"` (or `@`, `:`, `/`, `#`, `%`, `?`, a space)
  must be **percent-encoded** in the URL anyway (`"` is `%22`, `@` is `%40`, `%` is `%25`).
  Percent-encoded, it contains no quote and survives the launcher. Simplest of all: give the
  CSS database user a password made of letters and digits only.
- If a quote cannot be avoided, use a `.env.production.local` file in the app's root, BESIDE
  `app.js` (the standalone server loads it from its own folder: VERIFIED locally, the app
  reached the database with `DATABASE_URL` only in that file). `.env*` files are git-ignored
  and never in the build, so it is created on the server by hand; make it readable by the
  app's user only (`chmod 600`).
- **Do not set a variable in BOTH places.** A variable already in the process environment WINS
  over the file: VERIFIED locally, a wrong `DATABASE_URL` from the environment beat the right
  one in the file and sign-in failed. A value mangled by the launcher would silently win the
  same way. One source per variable.
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

The cPanel server is reported to be at **016**: it took `db/pg10-proof.sql` for 001 to 009, then
`db/pending-010-016.sql` (the table below is what that file held, kept for reference). It now
needs **017**, as the generated file **`db/pending-017-017.sql`**, applied ONCE:

```
psql -X -v ON_ERROR_STOP=1 -f pending-017-017.sql "<connection>"
```

| File | What it does | Precondition |
|---|---|---|
| `017_visit_corrections.sql` | `visit` gets `correction_reason` / `corrected_at` / `corrected_by` / `voided_at`, `visit_to_see_not_blank_check`, and two unique indexes: one open visit per client, one per visitor | 016. The unique indexes cannot fail on a server where nothing has written a visit (check-in was not wired before this release). If visits were written by hand, two open visits for one person would make it fail loudly, by design. |

**Apply 017 BEFORE starting the release that contains it**: check-in, check-out and corrections
write the new columns, and every visit query reads `voided_at`. The old code runs fine on a 017
database (the columns are only added), so the order is: migrate, then deploy.

Already applied (010 to 016, via `db/pending-010-016.sql`):

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

1. **Migration 017 applied** (above), from `db/pending-017-017.sql`.
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

## 3. Building, the files, and starting

### The startup file: `app.js`

`deploy/app.js` in the repo; the build copies it to the root of the deployable folder. In
cPanel's **Setup Node.js App**: *Application startup file* = `app.js`, *Application mode* =
Production. It:

- takes the **port from `PORT`**, as the launcher gives it (Next's own `server.js` reads it;
  nothing is hard-coded);
- takes the **address from `HOST`**, else `0.0.0.0`. It does NOT use `HOSTNAME` (which Next's
  server would otherwise read): on Linux `HOSTNAME` is often the machine's own name, and Next
  would then listen on whatever that resolves to;
- sets `NODE_ENV=production` and loads `server.js` beside it. It reads no secret.

### HOST CONSTRAINT: webpack, never Turbopack

**The cPanel host's glibc is older than 2.29.** Next's native compiler
(`@next/swc-linux-x64-gnu`) needs GLIBC_2.29, so it cannot load there; Next falls back to the
WebAssembly SWC bindings, which work. **Turbopack refuses to run without native bindings**
("Turbopack is not supported on this platform ... use Webpack instead"), and Next 16 builds
with Turbopack by default. So CSS is built with **webpack** (`next build --webpack`), on the
server and locally alike: ONE build path, so every local check tests the artifact that ships.

This is a constraint of the host, not a preference. **Anyone who "modernises" the build back to
Turbopack breaks the deploy.** And any dependency that needs a newer glibc (a native module
built against it) will fail on this host the same way: one more reason the dependency list
stays small (`pg` and Next's own).

On the server Next downloads the WASM SWC package (`@next/swc-wasm-nodejs`) from the npm
registry at build time, so the build needs outbound HTTPS to the registry as well as to Google
Fonts.

### Build

```
npm ci
npm run build:standalone
```

`build:standalone` runs `next build --webpack` (with `output: "standalone"` in
`next.config.ts`), then ASSEMBLES `.next/standalone/` and checks it. `npm run build` and the
screenshot runner use the same arguments (`NEXT_BUILD_ARGS` in
`scripts/build-standalone.mjs`). The build needs dev dependencies (TypeScript) and **outbound
HTTPS to Google Fonts** (`next/font/google` downloads Inter at build time and then serves it
from the app itself; nothing is fetched from Google at run time). A webpack build takes about
two minutes locally.

### What the standalone output does NOT copy, and has to be placed beside it

`next build` writes `.next/standalone/` with `server.js`, a traced `node_modules` (about 54 MB
with webpack: `next`, `react`, `pg`, and sharp's image library, which webpack traces in and CSS
never loads) and `.next/server`, but deliberately leaves out:

| Copy from (repo) | To (inside the deployable folder) | Without it |
|---|---|---|
| `.next/static/` | `.next/static/` | **every page is unstyled and nothing on it works**: all CSS (`static/css/` with webpack), all JavaScript (`static/chunks/`) and the Inter font files (`static/media/*.woff2`) are here |
| `public/` | `public/` | empty today; copied so a file added later is not silently missing |
| `deploy/app.js` | `app.js` | cPanel has nothing to start |

`npm run build:standalone` does all three and then FAILS if `app.js`, `server.js`,
`node_modules/next`, `node_modules/pg`, a CSS file or a font file is missing, or if any `.env`
file has got into the folder.

### What goes to the server

The CONTENTS of `.next/standalone/`, as the application root:

```
app.js                 <- startup file
server.js              <- Next's server (loaded by app.js)
package.json
node_modules/          <- traced; do NOT run npm install over it
.next/                 <- HIDDEN folder: server/, static/, manifests. Easy to lose in a zip
public/                   or an FTP upload that skips dot-folders. Without .next/static the
.env.production.local     pages are unstyled; without .next/server nothing runs.
  (only if used; created on the server by hand, never uploaded from here)
```

Because the folder carries its own `node_modules`, cPanel's "Run NPM Install" must NOT be used
on it (it would replace the traced modules with a full install from `package.json`, and the
build tooling it lists is not needed to run).

### Start

cPanel starts `app.js` itself. By hand (and this is exactly what the local check does):

```
cd <application root>
PORT=3000 HOST=127.0.0.1 node app.js
```

`npm start` in the repo does the same from `.next/standalone/` after a local build. `next start`
is no longer used.

### Proven locally (Windows, Node 24, production WEBPACK build)

- The webpack build was proven again in full after the switch from Turbopack: the assembly
  checks, the page sweep, the TLS scenario (all three proxy shapes: sign-in, Secure cookie,
  https redirects, styles and the Inter font by computed style, sign-out) and the full
  board-and-register scenario on a messy month. No difference from the Turbopack pictures.
- NATIVE versus WASM compiler (the server uses WASM): three local webpack builds (native,
  native again, WASM forced with Next's internal `NEXT_TEST_WASM` switch, for this test only)
  gave byte-identical CSS and fonts. The JavaScript of the five pages with forms differs
  between ANY two builds, native ones included (Next makes the server-action ids per build);
  the only WASM-only difference was the ORDER of five keys in webpack's runtime chunk (same ids,
  same behaviour). The server's own build has still not been run end to end.

- `npm run shots` now builds, assembles, and starts `node .next/standalone/app.js` on a spare
  port with `PORT` and `HOST` from the environment, then signs in and loads the pages. Every
  later visual check therefore runs the deployed artifact. The board and the register loaded
  with their CSS and the Inter font (the TLS check below tests both by computed style and by
  loaded font faces).
- `scripts/shots-tls.ts`: behind a local proxy that TERMINATES TLS and forwards plain http (as
  LiteSpeed does), reached as `https://frontdesk.graceonlyestates.com` (mapped to this machine
  inside the test browser only). See section 4.

### NOT proven: a build made on Windows, run on Linux

The bundle built on this machine carries **Windows** native packages (`sharp` and
`@img/sharp-win32-*`, pulled in by Next for image optimisation, which CSS does not use) and
**Windows paths** in its recorded configuration (`outputFileTracingRoot`). Whether such a bundle
runs on the Linux host has NOT been tested. The safe course is to **build on Linux**: on the
server itself if its memory limits allow (section 7), or on another Linux machine with the same
Node major version, and upload that folder.

## 4. What would break, or behave differently, on a shared host

Known from the code:

- **The session cookie is `Secure` in production.** A browser drops a `Secure` cookie that
  arrives over plain `http`: sign-in would "succeed" and land back on the sign-in page, with no
  error. The site MUST be served over HTTPS (and the address used must be the https one).
- **Behind LiteSpeed (TLS terminated, plain http to the app): VERIFIED to work, with one
  setting.** The `Secure` flag depends only on `NODE_ENV`, not on how the request reached the
  app, so the browser (which speaks https) keeps the cookie; the app does NOT need to be told it
  is behind a proxy for that. The redirect to the sign-in page stays on https (Next sends it
  relative to the page). What DOES depend on the proxy is Next's protection of server actions
  (every form): the browser's `Origin` must match the `Host` (or `X-Forwarded-Host`) the app
  receives. `scripts/shots-tls.ts` tried three proxy shapes:
  - Host passed through, no `X-Forwarded-Proto`: works.
  - Host rewritten, `X-Forwarded-Host` and `X-Forwarded-Proto` sent: works.
  - Host rewritten, nothing forwarded: **every form failed with a 500** ("Invalid Server
    Actions request") until `next.config.ts` named the public address in
    `experimental.serverActions.allowedOrigins` (`frontdesk.graceonlyestates.com`). With it,
    this shape works too.
  So the app IS told its public name, at BUILD time. **If the domain ever changes, change that
  line and rebuild**, or forms may fail behind the proxy.
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

1. Open https://frontdesk.graceonlyestates.com; the sign-in page must be STYLED (burgundy
   heading, Inter). An unstyled page means `.next/static` did not arrive. Sign in with the
   owner's account; change the password when asked. Landing back on the sign-in page with no
   error means the cookie was dropped (not https), or a form was refused (see section 4).
2. `/attendance` loads (the board, empty). `/attendance/register` loads for the admin.
3. Enter one arrival on `/attendance/arrivals`, clock it out, correct it, and see it marked
   "Corrected" on the board and in the register.
4. The visitor log (after 017): on `/visits/new` check in a non-client (a Delivery, with the
   consent tick), see them on `/visits`, check them out, then correct the visit on its page and
   see it marked "Corrected". A client search needs the portal variables; with the portal
   unreachable, a Client's failed search must still check them in, marked "Not verified".
5. Sign out, and confirm the session is gone (the back button does not get you in).

---

## 6. Things deliberately NOT on the server

- The screenshot account and all `scripts/shots-*` tooling (local only, refuse non-local).
- `db/pg10-proof.sql` (for an empty PG10 database, not this one).
- Any `DROP`/`CREATE SCHEMA`: the README's "Start over" is for a local database only.

---

## 7. What is NOT known (find out before deploying)

- **Exactly how the host's launcher runs `app.js`** (Passenger, or LiteSpeed's own Node
  handler) and what it puts in `PORT` and `HOST`. `app.js` takes both from the environment and
  has run locally under plain Node; it has not run under the host's launcher.
- **Whether a Windows-built bundle runs on Linux** (section 3): build on Linux instead.
- **Which headers LiteSpeed forwards** (`Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`,
  `X-Forwarded-For`). CSS now works with any of the three shapes tested; what LiteSpeed sends
  still decides what the sign-in rate limit sees as the client address (section 4).
- **Which Node versions the host offers**, and whether 22.9+ is among them (the scripts need it).
- **Whether `npm run build:standalone` fits in the host's memory and process limits**, and
  whether the host allows the outbound HTTPS to Google Fonts the build needs. If not, build on
  another Linux machine and upload the assembled folder.
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
