# CSS — Customer Support System (GEL)

Front-desk visitor log, staff attendance, and complaint handling for
Graceonly Estates Limited. Internal staff only. Separate app, separate
repo, separate database from the client portal.

## HARD RULES — read before writing any code

1. This is NOT the client portal. Do not copy design tokens, components,
   or layout from portal.graceonlyestates.com. The portal is dark-only.
   CSS is light. Every colour below comes from the Figma file; invent none.
2. The PORTAL owns complaints. It is the single source of truth. CSS has
   NO complaint tables of its own. A complaint raised in CSS is written to
   the portal; a complaint resolved in either app shows resolved in both.
3. A non-client gets an ENQUIRY, logged in CSS's own log. A non-client
   never gets a complaint case.
4. CSS talks to the portal only through its API, never its database, and
   every call carries the service key in the X-Service-Key header.
   - The five BUILT endpoints are read-only: health, client search, client
     summary, client documents, release-check. CSS never writes through them
     and never touches the portal database directly.
   - The CASE endpoints read AND write: create, message, start, ask,
     resolve, escalate. They are DESIGNED in sections 5.4, 6.1 and 6.4 but
     NONE is built yet, so rule 2 describes intent, not current behaviour.
5. Every screen is designed for desktop AND mobile. Both are in Figma.
   Responsive is a requirement, not a later pass — the visit log and the
   staff attendance screens above all.
6. Visitor records are kept permanently. Staff count is 20-30 today and
   growing.

## ATTENDANCE: HOW IT REALLY WORKS (supersedes every attendance line below)

The owner described the real process. It is NOT self-service clock-in. Where any
other line in this file (or any Figma frame) says staff clock themselves in, from
their own phones, or that a PERSONAL-device clock-in must be marked, THIS SECTION
WINS and that line is stale.

- Staff sign a PAPER attendance book at reception. The paper is the real record;
  CSS is a copy of it.
- ONE or TWO front-desk people, plus the owner as admin, are the ONLY people who
  will ever have a login. The staff whose attendance is recorded DO NOT sign in
  and never will. There is no signup and never will be (the rule is unchanged).
- The front desk copies arrivals from the paper book into CSS IN A BATCH, and
  clocks people OUT one at a time as they leave through the day.
- She types a name. A person entered before MUST be suggested as she types
  ("divi" offers "Divine Mike"): she never retypes a known name. (Not built yet.)
  HOW: the roster is 20-30 people and will stay small, so the application LOADS
  it and matches in memory. NO name-prefix or trigram index, and no database
  extension (cPanel will not install one on PG10). Matching in the application is
  also what gives fuzzy duplicate detection, which no index would give here.
- A MOVEMENT BOOK also exists. When a staff member leaves the premises during the
  day they sign out and sign back in. The front desk records where they went,
  what for, who approved it, the time they left and the time they returned. An
  open movement (no return) means they are out NOW. (Table built in migration 010,
  corrections in 015; the movement book is built: see "The movement book".)
- ANY earlier day can be entered or corrected, with a reason recorded.
- So `staff` holds two kinds of person: a LOGIN account (password hash, email) and
  a ROSTER person (no password, usually no email, department optional) who is only
  ever the subject of attendance, or the approver named on a movement. A roster
  person cannot sign in: auth refuses a NULL password hash and treats it exactly
  like an address that does not exist (same one scrypt run against the dummy hash,
  same no-op write, same message, same simulated lockout).
- THE DEVICE IS ALWAYS THE FRONT DESK'S OWN BROWSER. The device columns on
  `attendance_record` (009) stay, harmless, with a changed meaning: "the machine
  the ENTRY was made on", never "where the staff member was". The tightening switch
  `attendance.clock_in_requires_desk_device` is likewise moot for now; nothing
  reads it.
- WITHDRAWN: screen 08 does NOT mark PERSONAL clock-ins (marking every row would
  be noise). REPLACED BY: screen 08 MUST SHOW WHO ENTERED EACH RECORD
  (`attendance_record.clock_in_entered_by` for the arrival and
  `clock_out_entered_by` for the departure: with two front-desk people they are
  often different people, and "who typed this" is the accountability mechanism for
  the whole feature). A movement likewise carries `left_entered_by` (the departure) and
  `returned_entered_by` (the return). ONE PATTERN everywhere: `<event>_entered_by`. One person typing everyone else's
  attendance is the thing that must be visible. The same goes for a back-dated
  entry and a correction (their reasons are recorded).
- Screen 07 is now the TODAY BOARD: "who is in right now", and where the front desk
  clocks people out one at a time and closes the day (built; see below).
- Enforced in the APPLICATION, not the database (each has a comment at the schema):
  a movement lies inside its shift; a record created for an earlier day carries a
  `backdate_reason` (now() cannot appear in a CHECK).
- BACK-DATING MEANS AN EARLIER LAGOS DAY, NOT A LATE ENTRY. A record created for a
  Lagos calendar day before today needs a `backdate_reason`. Typing this
  morning's arrivals at 10:30 is ordinary work and must NEVER ask for a reason,
  however late in the day it is typed: test the Lagos DATE of the clock-in
  against today's Lagos date (`lagosDateOf`), never elapsed time.
- A ROSTER PERSON GAINING A PASSWORD is a deliberate ADMINISTRATIVE act, never a
  side effect of anything: not of entering an email, not of attendance entry, not
  of a role grant. Nothing else may write `staff.password_hash` on a roster row.
  (Today the only writers are the create-staff script and a person's own password
  change; a roster person cannot reach the latter.)

### The batch arrival entry screen (BUILT; UNDESIGNED, not in Figma)

/attendance/arrivals, reached from a placeholder "Enter arrivals" button on 07.
FRONT_DESK or ADMIN only (requireAnyRole, before the roster loads; the save action
gates itself again). Files: `clockTime.ts` (the time field), `rosterMatch.ts`
(suggestions and the duplicate rule), `arrivalBatch.ts` (the rules, behind an
`ArrivalStore` interface), `arrivalStore.ts` (SQL), `attendance/arrivals/`.

- She picks a day (default today, Lagos) and types rows: name, time in. Save writes
  the whole page in ONE transaction. EVERY row is validated first and EVERY problem
  is reported against its row; if there is any problem, or any name awaiting
  confirmation, NOTHING is written. Blank rows are ignored.
- TIME FIELD: plain text, exactly 8:15, 08:15 or 0815 (24-hour). Anything else is
  refused with a message, never guessed ("815" and "8:15pm" are refused).
- THE DAY: a future day is refused; a time later than now today is refused. An
  EARLIER LAGOS DAY needs a reason (stored as backdate_reason on every record in
  the batch) and takes a time out per row (required: a record with no clock-out is
  an open shift, and a person may have only one). TODAY takes arrivals only and
  never asks for a reason, however late it is typed.
- ROSTER: a typed name that exists is that person; one nobody has creates a roster
  person (name only). SUGGESTIONS match any word of the name, in the application.
  "CLOSE" (needs confirming as a different person before a new entry is made): after
  normalising, within 1 edit (2 when the longer name is 12+ characters; a swap of
  neighbouring letters is 1), or the same words in another order, or one a PARTIAL of
  the other (every word the start of a different word). Equal means the same person,
  no question. Close is a question, never an answer: the screen never decides.
- ONE RECORD PER PERSON PER LAGOS DAY is the APPLICATION's rule (the database only
  forbids a second OPEN shift). The people involved are locked FOR UPDATE in id order
  before it is checked. A person appearing twice in a page, or still recorded as in
  from an earlier day (for today's arrivals), is refused by name.
- Each record carries clock_in_entered_by (and clock_out_entered_by for an earlier
  day) = the signed-in user. The device columns stay NULL: no device is registered.
  One audit_log row per record, and per new roster person (ids only, never names).
- THE CLOSE-NAME PROMPT IS ANSWERED FROM THE KEYBOARD, in the row's flow: leaving the
  name (Enter or Tab) with a close name moves focus INTO the prompt; Y takes the first
  person offered (1, 2, 3 the others), N says a different person, Left and Right move
  between the buttons, and focus then goes on to the time in. One reach for the mouse
  per near-duplicate is the friction that makes people stop using a tool.
- "NEVER SIGNED OUT" ON AN EARLIER DAY is a per-row choice INSTEAD of a time out (those
  exact words): N in the Time out box (or a checkbox, for touch) closes the record with
  NO time, already marked (013); its hours are unknown. Refused with a time out, and
  refused for today (the board's end-of-day action closes today).
- Keyboard: Enter or Tab moves on; past the last field a new row appears; arrows
  move through suggestions and Enter takes the highlighted one (a single suggestion
  is already highlighted). Tab never takes a suggestion. Enter never submits.
- THE DAY IS ALWAYS SHOWN IN WORDS beside the picker ("Wednesday, 21 October 2026",
  formatLongDate): the picker uses the browser's locale, and 10/21/2026 read
  day-first is the 10th of December. Never rely on the picker's own formatting.
- A CLOSE NAME OFFERS THE EXISTING PERSON: "Did you mean Ada Okafor (Legal)?" with a
  "Yes, Ada Okafor" button that takes that person, and "No, a different person".
  Over-asking is cheap and is preferred to a near-duplicate on the roster.
- TWO PEOPLE WITH ONE NAME are told apart in the suggestions and the prompt by
  department and when they were added (personDetails), then "1 of 2". Refusing the
  ambiguity is right; leaving her unable to resolve it is not.
- THE CAPITALISATION OF A TYPED NAME IS NEVER CHANGED, DELIBERATELY. Names are stored
  exactly as typed (cleanDisplayName only tidies spacing); comparison ignores case
  (normaliseName) but storage never does. Reason: every auto-capitalisation rule is
  wrong some of the time and silently, and these are real people's names ("van der
  Merwe", "O'Brien", "Obi-Eze", "de Souza"). The one concession is the on-screen
  keyboard's own hint (autoCapitalize="words" on the name field): it is visible as she
  types and she can correct it; the application itself never rewrites a name. If
  that hint proves wrong in practice, set it to "off", never add a rewrite on save.
  The owner CONFIRMED keeping it on: it suggests, she sees it, and the stored name is
  never rewritten. The app changing a name silently stays forbidden.
- Verified with `scripts/shots-arrivals.ts` against a THROWAWAY schema (seed:
  `scripts/shots-arrivals.seed.sql`; `SHOTS_DATABASE_URL` must be local). Never run
  a writing scenario against the owner's local `public` data.

### The today board (BUILT; UNDESIGNED, not in Figma): screen 07, repurposed

/attendance (the nav's "Attendance" link). FRONT_DESK or ADMIN (requireAnyRole before
anything loads; the actions gate themselves again). Files: `todayBoard.ts` (the
grouping, pure), `departures.ts` (the clock-out and no-sign-out rules, behind a
`DepartureStore`), `departureStore.ts` (SQL), `attendance/page.tsx`,
`ClockOutControl.tsx`, `EndOfDay.tsx`, `attendance/actions.ts`.

- For TODAY in Lagos it shows four groups and a count of each, all DERIVED, never
  stored: IN now; OUT on a movement (someone with a LIVE movement that has not
  returned: where, what for, who approved it, how long gone); GONE for the day; NO SIGN-OUT. An open
  shift left from an EARLIER day is shown IN, flagged "open since <day>": it is the
  forgotten shift, and it blocks that person's next arrival.
- CLOCK OUT, one person at a time: the time defaults to NOW (from the server's render
  time, so a wrong browser clock cannot put a future time in the box) but is editable.
  It is a time of day on the record's OWN Lagos day (an earlier day's open shift takes
  its time on that day, with no default). Refused: not after their time in; in the
  future; out on an open movement (record the return first); before a movement of
  theirs ended (a movement lies inside its shift; the database cannot check that, this
  does). Records clock_out_entered_by (the signed-in user: the arrival and the
  departure can be different people). One audit_log row. The record is locked FOR
  UPDATE and the write is guarded "still open", so two users cannot both win.
- NO SIGN-OUT (migration 013, `signout_missing_at`/`signout_missing_by`): the
  CLOSED-BUT-NO-TIME state. It is always an EXPLICIT act: per person ("<name> never
  signed out", in the clock-out panel) or the end-of-day panel, which lists the people
  and asks for confirmation. The app NEVER does it silently. THE HOURS OF SUCH A SHIFT
  ARE UNKNOWN: never zero, never guessed (not to the end of the day, not to a usual
  finishing time). Any total, week or timesheet that includes one must say so or leave
  it out and say so. It can be undone (unmarked, or given a time) under "Corrections".
- Ticking durations use the shared useNow interval (<Duration />); the board adds no
  timer of its own. LIVE REFRESH (BoardRefresher): the board re-reads the server about
  every 30 seconds on a beat of that SAME shared clock, so there is ONE shared poll and
  useNow.ts stays the only ticking interval. It does nothing while the tab is hidden
  (refreshDue), and a tab that comes back visible refreshes at once. A refresh keeps
  client state, so a panel she has open survives it; the correction panel keeps the
  VERSION of the record it was opened with, so a change by the other front-desk person
  meanwhile is refused cleanly rather than overwritten.
- Any DAY can be shown (`/attendance?day=YYYY-MM-DD`, not in the future): the same
  board for the records that started that day, titled "Who was in", with the day in words.
  Corrections work on any day. Only today shows the end-of-day panel and open shifts
  carried from earlier days.
- Verified with `scripts/shots-board.ts` (seed: `scripts/shots-board.seed.sql`) against
  a THROWAWAY schema, like the arrivals screen.

### Corrections (BUILT; UNDESIGNED), migration 014

She will type 09:30 where the book says 08:30. A mistake that cannot be fixed makes her
keep a second paper list, and then CSS is decoration. Files: `corrections.ts` (the
rules, behind a `CorrectionStore`), `correctionStore.ts` (SQL), `RowActions.tsx` (the
"Correct…" panel on every row of the board), `attendance/actions.ts`.

- WHAT CAN BE FIXED, from the board, for any day: the time in; the time out (or giving a
  time to a shift marked never signed out); REOPEN a shift closed by mistake; UNMARK a
  never-signed-out; REMOVE a record entered for the wrong person.
- EVERY CORRECTION REQUIRES A REASON. No exception, no default text, no silent fix. The
  reason is the control, not a permission gate: FRONT_DESK and ADMIN may both correct,
  because the person who typed the mistake is the person who notices it, usually within a
  minute. The reason is checked FIRST, before anything is read.
- Every correction records who and when (`corrected_by`, `corrected_at`,
  `correction_reason`: all three together or none, enforced by the database; they hold the
  LATEST correction) and writes an audit_log row with the before and after (the full
  history). The person and the record are locked FOR UPDATE, and the version the person
  was looking at (the row's `updated_at` as text, to the microsecond) goes back with the
  form: a record someone else changed meanwhile is refused with a clear message, nothing
  written. A stale clock-out says who got there first ("Peter Obi was already clocked out
  at 10:47 by <name>"). Never a database error, never a silent double write.
- A CORRECTED RECORD IS VISIBLY MARKED WHEREVER IT IS LISTED: a "Corrected" pill and
  "Changed at 11:14 by <name>: <reason>" in its row. SCREEN 08 MUST DO THE SAME when it
  reads real data (it now does): a reader of the register must see that a
  time was changed, by whom and why, without going looking.
- Reopening or unmarking puts the record back to OPEN, and a person may have only ONE open
  shift: if they already have one it is refused, naming it ("already recorded as in since
  21 Oct 2026, and a person can have only one open shift. Clock that one out first.").
- A time lies on the record's own Lagos day, is not in the future, keeps the shift in order
  (in before out) and a movement inside its shift (the database cannot check that).
- WRONG-PERSON RECORDS ARE A VOID, NOT A DELETE. The row stays (`voided_at`), with its
  reason and who removed it. A deleted row cannot be audited (audit_log points at it by id)
  and other rows point at a record (movements); staff and what points at them are never
  deleted here. The clutter objection is answered by leaving a voided record out of EVERY
  list, count, the one-record-a-day check and the open-shift index: it appears only in the
  board's "Removed records" list. Any new query of attendance_record MUST exclude
  `voided_at IS NOT NULL` the same way. A record with (live) movements cannot be removed.
- A REMOVAL HAS A WAY BACK: RESTORE (un-remove) is the same shape as every other correction:
  a reason, who and when recorded, visibly marked, one audit row, the version check. It is
  BLOCKED, naming what is in the way, if putting the record back would break the
  one-open-shift rule or the one-record-a-day rule. (Without it a mis-removal gets "fixed" by
  entering a duplicate.) Removed records are restored from the "Removed records" list.
- A REFRESH NEVER TAKES AWAY WHAT SHE IS TYPING. The live refresh is PAUSED while any panel is
  open (anything marked `data-pause-refresh`) or any field in the page has focus; it is
  paused, not dropped, and runs as soon as she is done (focus leaves a field, or a click
  closes the panel). A refresh can move a row to another group, which would unmount the
  panel under her and lose what she typed; the stale-write protection does not help her
  retype it. Any new panel on the board MUST carry `data-pause-refresh`.
- Not built yet: correction HISTORY on screen (only the latest correction is in the row; the
  full history is in audit_log), and moving a record to a different day (remove it and enter
  it again).
- Verified with `scripts/shots-corrections.ts` (seed: `scripts/shots-corrections.seed.sql`,
  after the arrivals and board seeds) against a THROWAWAY schema.

### The movement book (BUILT; UNDESIGNED), migration 015

The second paper book at reception: a staff member leaves the premises during the day,
signs out, and signs back in. The front desk copies it in. Files: `movements.ts` (a
departure and a return), `movementCorrections.ts` (corrections), `movementStore.ts` (SQL
and the suggestions), `phraseMatch.ts`, `nameResolution.ts`, the shared components
`Combobox`, `ClosePrompt` and `NameField`, and on the board `RowActions.tsx` (Out…, Back…),
`MovementItem.tsx` (one movement and its corrections) and `BoardData.tsx`.

- A DEPARTURE is recorded from a person who is IN ("Out…"): where to, what for, who approved
  it, the time left (default now on the office clock, editable, same rules as the clock-out
  time). The movement must sit INSIDE the shift (after the time in; the database cannot
  check it, the application does, in the same transaction, under the person and record locks).
  Movements of one record never overlap, and a person is out at most once at a time.
- THE APPROVER IS A ROSTER PERSON, resolved by the ONE name rule used by the arrivals sheet
  (`nameResolution.ts`, the `NameField` component): suggestions as she types, a CLOSE name
  asks "Did you mean ...?" and is answered from the keyboard (Y, N, 1-3), a name nobody has
  creates a roster person. Do NOT write a second matcher or a second combobox.
- A PERSON MAY APPROVE THEIR OWN MOVEMENT (owner's decision; it used to be refused). When the
  most senior person in the building leaves there is nobody above them, and refusing it left her
  unable to record the movement at all. It is allowed and MARKED "Self-approved" wherever the
  movement is shown (its line on the board, the phone row's one line, the register's row, with an
  amber pill). Visible, not forbidden: the same principle as corrections. It is DERIVED
  (`approved_by` = the record's `staff_id`), never stored. The Out… panel says so before saving.
- A RETURN is recorded from a person who is OUT ("Back…"): the time back (default now,
  editable), as `returned_entered_by`, which may be a different person from `left_entered_by`.
  A return must be after the departure, not in the future, and before any time out.
- DESTINATIONS and PURPOSES are SUGGESTED from what has been used before: the distinct values
  (one spelling each, most used first, removed movements left out) are loaded and matched in
  the application, as the roster is (`phraseMatch.ts`). No index, no extension.
- NO DRIFT in destinations and purposes ("Bank", "bank" and "First Bank" as three places make
  any report on movements worthless). `resolvePhrase` (phraseMatch.ts), on the screen
  (`PhraseField`, built from the same Combobox and ClosePrompt) and again on the server:
  differing ONLY BY CASE OR SPACING (`phraseKey`: lower case, every space removed, so "FirstBank"
  is "First Bank") takes the EXISTING spelling, which the box shows ("Same as one used before:
  saved with this spelling"); a CLOSE one (the roster's isClose rule: a typo, a partial, other
  punctuation or word order) is a question offering the existing one ("Did you mean First
  Bank?", Y / N / 1-3, "No, a different place"); anything else is new and kept as typed. The
  phrase list is ONE query (`loadPhrases`: grouped by the same key, the most-used spelling kept),
  sent to the screen and read in the transaction, so the two cannot disagree. A correction does
  not offer the movement's own current value back. Existing drift in old rows is not rewritten.
- A PERSON OUT ON A MOVEMENT CANNOT BE CLOCKED OUT until they are back, and the message says
  why: "<name> is recorded as out on a movement. Record their return first." The row offers
  Back…, not Clock out. Likewise they cannot be marked never-signed-out, and a record with
  live movements cannot be removed.
- CORRECTING A MOVEMENT: the time left, the time back, the destination, the purpose, the
  approver, REMOVE it (a void, as for attendance) and RESTORE it. Every one needs a REASON
  (no default text), records who and when (`corrected_by`, `corrected_at`,
  `correction_reason`: all three or none), writes an audit row, is checked against the movement
  version she was looking at (a change by the other front-desk person meanwhile is refused
  cleanly) and is VISIBLY marked in the movement's line ("Corrected" / "Removed", by whom, why).
  Restoring is blocked if it would make the person out twice at once or overlap another movement.
- A REMOVED MOVEMENT COUNTS FOR NOTHING: not "out right now", not in any count, not in any
  overlap or inside-the-shift check, and it does not keep the person from leaving again (the
  open-movement index excludes it). Any new query of `movement` MUST exclude
  `voided_at IS NOT NULL` the same way.
- Verified with `scripts/shots-movements.ts` (seed: `scripts/shots-movements.seed.sql`, after
  the arrivals and board seeds) against a THROWAWAY schema, including the refresh pause.

### Finding a row on the board (BUILT; UNDESIGNED)

- A FILTER BOX ("Find a person", `BoardFilter.tsx`): type part of a name and the lists narrow
  (the suggestions' word rule, `matchesFilter`). It filters WHAT IS SHOWN and NEVER A COUNT: the
  tiles and section counts are the day's truth, not a view of it, and the box says "Showing 2 of
  16 people on the board. The counts are for the whole day". A section the filter empties says
  so. It does not touch the end-of-day list. Escape clears it.
- ON A PHONE every row is COLLAPSED by default (`PersonRow.tsx`) to the name and one line ("In
  08:05 · 2h 10m", "Out: Bank · since 10:12", "No sign-out", "· Corrected"), with a Show button;
  opened, it shows the facts, movements and actions. Thirty open rows were 5000px. When the
  filter leaves ONE person, that row opens by itself. The DESKTOP IS UNCHANGED: the head and body
  are `display: contents` there. A collapsed row keeps its panel (and the refresh pause).

### Settled, NOT doing (do not revisit)

- THE APPROVER CONFIRMATION STAYS. A close approver name is a question; that is the guard
  working, not friction to remove.
- NO MOVEMENT FOR SOMEONE NOT RECORDED IN. Sort the attendance record out first (enter the
  arrival, reopen, or correct), then record the movement.
- THE DEPARTURE TIME KEEPS DEFAULTING TO NOW. She records movements as they happen; a blank field
  would cost about thirty keystrokes a day to save the occasional correction, which "Correct…"
  already handles.

### The attendance register, screen 08 (BUILT on real data)

/attendance/register, ADMIN only (requireRole before anything loads). Files: `register.ts` (the
rules, pure, tested), `registerStore.ts` (SQL, read only), `attendance/register/`. Any Lagos day
or period (`?from=&to=`, at most 92 days; quick links Today, Yesterday, This week, This month,
Last month; a backwards, future or unreadable period shows today and says why).

- HOURS: EVERY SHIFT IS ONE OF FOUR KINDS, counted the same way everywhere (period, department,
  person): COMPLETE (in and out: known hours, the ONLY thing in the total); NO SIGN-OUT (hours
  UNKNOWN); OPEN FROM AN EARLIER DAY ("Never closed": hours UNKNOWN, exactly like a no-sign-out;
  it counts as a shift that day and can be late, but is never completed and never run up to now);
  IN PROGRESS (open, today: not finished, shown with its time so far, not in the total). A total
  is NEVER shown without the unknown count beside it, and `honestyNote` says in words what it
  leaves out ("it is a minimum, not the hours worked"), and from 20% unknown that it says little.
  Hours are time in to time out; movements are NOT deducted (said on the screen).
- REMOVED records are not read (only their number, "5 removed records ... are not counted").
- WHO ENTERED: each record shows "entered by" for the arrival and for the departure separately
  (and "marked by" for a no-sign-out); a "Who entered" card counts each front-desk person's
  arrivals, departures and no-sign-out marks for the period.
- MARKS, visible in the row: Corrected (who, when, why), RESTORED (from audit_log: the latest
  correction whose kind is `restore`, so a later correction cannot hide it), Back-dated (the
  reason), Self-approved movements. In a period, a person's PLAIN completed shifts fold into
  "N shifts, all complete and unchanged"; a marked shift is never folded.
- LATE IS JUDGED FROM THE SNAPSHOT ON THE RECORD (`attendance_record.late_after_local`,
  migration 016), strictly after it on the record's own Lagos day, NEVER from the setting as it
  is now: the setting exists to be changed, and changing it must not re-judge a past period. The
  arrivals batch copies the setting onto every record it creates (read once per batch; parsed as
  a time of day or stored NULL). A CORRECTION NEVER MOVES THE SNAPSHOT: the rule in force on the
  day still applied; a correction fixes what was typed, not which rule was in force. A record with
  NULL has UNKNOWN lateness ("Late: unknown", counted apart, never folded away, never on time by
  default). When a period spans a change of rule the tile says "by each day's rule (09:00,
  09:15)" and a late pill names the rule it broke. A back-dated record takes the setting at ENTRY
  (setting history is not kept). Same pattern as `visit.client_name_logged` and the device-kind
  snapshot: a value that can change later is copied onto the row when it is written.
- NOT DONE, and REQUIRED THE MOMENT DEPARTMENT EDITING EXISTS: a DEPARTMENT SNAPSHOT. The
  register groups a record by the person's CURRENT department, so moving someone would move
  all their history with them. Nothing can change a department today, so it is hypothetical;
  whoever builds department editing must add the snapshot (a migration, like 016) in the same
  change.
- Grouped by department A to Z, "No department" last. People with leave and no record: "On
  leave". Active people with neither: "No record", worded as not proof of absence. The
  department chips stay static counts (people with a record), derived from the data.
- Verified with `scripts/shots-register.ts` (seed: `scripts/shots-register.seed.sql`, a messy
  month, after the arrivals, board and movements seeds) against a THROWAWAY schema. It also
  drives the board's filter, the phone collapse, drift and self-approval.

## Design tokens — from Figma, exact

Source: https://www.figma.com/design/yWUjcYUogDXQqBJ1uKAd1B/CSS-%E2%80%94-Customer-Support-System--GEL-?node-id=3-21
The design system is named "fold". Define these once as CSS custom
properties and never hardcode a hex anywhere else.

--fold-burgundy:        #800020   /* primary: brand, headings, buttons */
--fold-burgundy-steel:  #9f6672   /* secondary/outline buttons, borders */
--fold-gold:            #b8921f   /* accent: links, logo mark, highlights */
--fold-dusk:            #7a525e   /* body text, labels */
--fold-smoke:           #ae969b   /* PLACEHOLDER text only (see rule below) */
--fold-silver:          #d9cdd0   /* borders, table rules */
--fold-mist:            #ede4e1   /* avatar and panel fills */
--fold-canvas:          #f9f8f6   /* page background, input fills, chips */
--fold-white:           #ffffff   /* cards, nav, table surfaces */
--fold-status-green:    #16a34a   /* on track */
--fold-status-green-ink: #15803d  /* status-coloured TEXT on white only */
--fold-status-amber:    #d97706   /* long */
--fold-status-amber-ink: #b45309  /* status-coloured TEXT on white only */
--fold-status-red:      #dc2626   /* overdue; also used for red text */

The two *-ink tokens are the ONLY colours that are not in the Figma file
(owner-approved). The green and amber fills fail WCAG AA as text on white
(3.30:1 and 3.19:1); the inks pass at 5.02:1. Use an ink whenever green or
amber is TEXT on white (elapsed timer, KPI deltas, complaint age). Fills,
dots and pill tints keep the original tokens. Red needs no ink: it already
passes at 4.83:1, so red text uses --fold-status-red. The Figma file should
be updated to add the two ink colours to match.

GLOBAL RULE: --fold-smoke is for PLACEHOLDER text only (today: the login
input placeholders). It is 2.75:1 on white and fails AA. Any text that
carries real information (sub lines, captions, comparison text, times,
counts) uses --fold-dusk (6.57:1), whatever the Figma file says.

There is NO dark mode. The page background is canvas; surfaces are white.

## Type — Inter only

Weights used: 400 regular, 500 medium, 600 semibold, 700 bold.

display   100px / 0.91  bold      tracking -5px     (hero only)
h2         24px         semibold  tracking -0.72px
lede       18px / 1.41  regular   tracking -0.54px
body       16px         regular
strong     14px         semibold  (names, row values)
small      13px         regular   (secondary row text)
label      10px         semibold  tracking 0.4px    UPPERCASE
eyebrow    10px         semibold  tracking 1px      UPPERCASE

Note the pattern: large text has NEGATIVE tracking, small uppercase
labels have POSITIVE tracking. Keep it.

## Shape and depth

Radii:   4px small marks · 7px logo mark · 8px mobile logo mark · 12px cards
         24px floating nav · 9999px pills, inputs, buttons, AVATARS
Avatars are circles at every size (36, 40, 72px ...): use
--fold-radius-pill. Do not add per-size radius tokens.

Shadows (all tinted burgundy, never grey):
  subtle  0 1px 4px  rgba(128,0,32,0.10)
  nav     0 6px 16px rgba(128,0,32,0.12)
  card    0 9px 25px rgba(128,0,32,0.12)

Spacing scale: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 24 · 28 · 32 · 36 · 40
(all are --fold-space-N tokens; 2px and 3px gaps and paddings stay literal)
Card padding 32px; table card 20px top / 24px sides / 24px bottom.
Table rows: 14px vertical padding, 16px column gap, 1px silver bottom rule.

## Component vocabulary

- Button, primary: burgundy fill, white text, semibold, full pill, subtle
  shadow. Three sizes, all deliberate:
    default   14px text, 24px/14px padding
    compact   13px text, 20px/12px padding
    login     16px text, 24px/14px padding, full width (login submit only;
              16px stops iOS zooming the page on focus)
- Button, row action: white fill, 1.5px burgundy-steel border,
  burgundy-steel text (4.55:1 on white), 12px semibold, 32px tall, pill.
  Built; used for "Check out" (03) and later "Open →" (06).
- Input: canvas fill, 1px silver border, 48px tall, pill, 16px text,
  smoke placeholder. Label above it in 10px uppercase dusk.
- Chip / tag: canvas fill, 10px uppercase dusk label, pill, 10px/4px.
- Status pill: dot + 10px uppercase label, pill, 10px/4px. HUGS its
  content; never stretches to fill a table column (Figma's stretch is an
  auto-layout side effect).
- Filter chips (FilterChips): white fill, 1px silver border, burgundy
  label, --fold-dusk count (Figma's smoke is 2.75:1). Selected is burgundy
  fill with a white label and a WHITE count (Figma's gold count on burgundy
  is 3.70:1, below AA). STATIC for now: read-only counts, no pointer
  cursor, no hover. Counts are computed from the data.
- Tables stack into cards below 768px (the 03 and 08 mobile designs both do
  this; never a horizontal scroll). The table primitives supply the card
  chrome and hide the header row; each screen sets the grid areas and marks
  cells that do not appear on mobile. 08's cards are denser (14/12 padding,
  8px gap): override --table-card-pad-x, --table-card-pad-y and
  --table-card-gap.
- Mobile page titles are 36px on every screen (one size, no prop). 08's
  mobile frame draws 32px; it uses 36px.
- Avatar: circle (--fold-radius-pill). 36px mist fill with burgundy
  initial in lists; 32px in mobile cards; solid burgundy with gold initial for the signed-in user
  (36px mobile top bar, 40px nav) and the visit-detail hero (72px).
- Card: white, 12px radius, card shadow.
- Floating nav (login): white, 24px radius, nav shadow, 24px/14px padding,
  logo mark + "CSS" only.

DECIDED — status pill colours (option A). Fill = the status colour at 12%
via color-mix on the existing token (no new hex); dot = the full status
colour; label = --fold-dusk, 10px uppercase semibold. On leave uses
--fold-burgundy-steel as its status colour. Applies to all eight pills.

FIGMA DEFECT — correct at source. In the Figma file the label (and dot) is
set to the same colour as the fill on all eight pills (nodes 26:46, 26:62,
26:78, 26:142, 32:69, 32:93, 32:117, 32:129): 100% opacity, one shared
variable, so the label is invisible. The same pattern appears in the 02
"3 OPEN" badge, the 05 payment pills and the 06 count badges (read from
the design context, not sampled). Fix the label colour in the Figma file;
do not mirror the defect in CSS.

## Navigation and app shell

- AppShell wraps every signed-in screen, 02 through 08. Figma draws those
  frames standalone without it; that is an omission, not intent. Login (01)
  keeps its own floating bar and does NOT use the shell.
- Desktop: floating nav, logo mark + "CSS" left; links centre; "+ New
  visit" button and the user's avatar right. Active link is gold semibold
  with a 2px underline (gold is only 2.93:1 on white, so the state is not
  carried by colour alone); others burgundy medium, 28px gap
  (--fold-space-28).
- Links, in order: Dashboard, Visits, Complaints, Attendance. No Documents
  or Analytics (no such screens). Complaints is visible to everyone.
- "Attendance" is the person's own attendance (07). The admin Attendance
  Register (08) is a separate role-gated route, not a nav item for
  everyone. The role gate is enforced on the server (see "Authentication").
- Mobile: top bar (logo mark + "CSS", compact "+ New visit" button, avatar)
  plus a BOTTOM TAB BAR with the same four destinations. The button is not
  in the mobile Figma; it is there because starting a visit is the front
  desk's main action. The tab bar stays at four destinations. The tab bar is NOT in Figma. It is a placeholder
  pending a real design: plain, existing tokens only, and commented as such.

## Screen behaviour decided outside Figma

- Mobile dashboard keeps the Open complaints panel, stacked below the
  visits panel. The "vs yesterday" comparison text is dropped on mobile, as
  in the design.
- Elapsed time is computed from the check-in timestamp and ticks live; never
  store it as a string. Colour: green under 10 minutes, amber 10 to 30, red
  over 30. Sample check-in times must agree with the elapsed values shown.
- Complaint age is computed from the raised-at timestamp, never stored as a
  string. Under 24 hours is neutral (--fold-dusk), 24 to 72 hours amber
  (ink), over 72 hours red. Sample raised-at times must agree.
- Timers tick from the browser clock, which can be wrong. TODO: the server
  already sends its render time (asOf); use it to correct client drift.
  All timers (ElapsedTime, ComplaintAge, VisitStatus) share ONE interval via
  src/lib/useNow.ts; never add a per-component setInterval.
- Visit status is derived from elapsed time, never stored: on track under
  10 minutes, long 10 to 30, overdue over 30 (VisitStatus).
- The visit list lives once in sampleData.ts (getVisitsSample). The
  dashboard shows the first five; 03 shows all seven. Each visit carries a
  short and a long reason label.
- "Check out" (03) renders enabled and is wired to nothing, with a TODO;
  it has no backend yet. Same for "Export timesheet" (08).
- Complaint queue (06) lives at /complaints. Complaints are the PORTAL's
  data. The sample rows mirror the portal's `disputes` row (id, referenceNo
  shown as CASE-0001, clientId, clientName, raisedByRole CLIENT|ADMIN, channel
  PORTAL|PHONE|WHATSAPP|IN_PERSON|EMAIL, typeCode and label, subject,
  description, status OPEN|IN_PROGRESS|AWAITING_CLIENT|RESOLVED|WITHDRAWN,
  version, raisedAt, lastClientReplyAt, resolvedAt, resolutionNote,
  escalated), not the mockup's shape. clientName is ASSUMED: the list
  endpoint's response shape is not specified. NONE of the case endpoints are
  built yet; only the five read-only CLIENT endpoints exist. The TODO for the
  portal read is at getComplaintsSample (the data boundary).
- Writes to the portal (resolving a case) will be POST
  /support-cases/{id}/actions, with a resolution note and the row's version
  for compare-and-set. They go to the PORTAL, never to a CSS table, through
  the case endpoints (rule 4), which read AND write but are not built yet.
  06 has NO "Mark resolved" control: a
  one-click control in a list would be a lie. "Open →" renders unwired (TODO)
  until the complaint detail screen exists (not among the eight, undesigned).
- Complaint types are the PORTAL's ten SEEDED dispute_types, mirrored exactly
  in DISPUTE_TYPES (sampleData.ts): ISSUE kind PAYMENT_NOT_REFLECTED,
  WRONG_AMOUNT_CHARGED, DOCUMENT_ISSUE, BOUNDARY_OR_ENCROACHMENT,
  REALTOR_CONDUCT; QUESTION kind DOCUMENT_RELEASE_CHASE,
  DOCUMENTATION_FEE_QUERY, ESTATE_TIMELINE, PLOT_OR_ALLOCATION, OTHER. A new
  type is an INSERT in the portal's dispute_types table, not a migration.
  `kind` (ISSUE or QUESTION) is a real field and is carried on every row.
- The type labels are CLIENT-FACING wording ("Chasing or speeding up my
  documents", "A question about my plot or allocation"): the portal shows
  them to clients, so at a staff desk they read oddly. Do NOT rewrite them;
  they are the portal's data. Different staff-facing wording, if ever wanted,
  is a later decision and a MAPPING on top, not an edit to these.
  TODO: PAYMENT_NOT_REFLECTED's label is still pending, so the UI shows its
  code until the exact text arrives (disputeTypeText).
- Every type targets a PURCHASE except REALTOR_CONDUCT and OTHER, which target
  nothing; a sample row carries purchaseId only when its type targets one
  (the field name is ASSUMED). NEVER add a REALTOR_CONDUCT case: that type is
  record-only and can never be read back by a CSS key (the sample types make
  it a compile error). A complaint belongs to a CLIENT; a non-client (the
  mockup's "B. Umeh, commission query") gets an ENQUIRY, not a case, so that
  card is not in the sample. The mockup's "Assigned to" and project/team
  lines have no field in the disputes row and are not shown.
- 06's tabs are the portal's real statuses: Open, In progress, Awaiting
  client, Resolved, All (WITHDRAWN only under All, with its own pill). They
  are real server-filtered links (?status=), local to 06 (no other screen has
  tabs), with counts computed from the data. Badges are a 12% tint with a
  dusk number, white on the selected burgundy tab. Escalated is shown as a
  pill with no control. In-progress, awaiting and resolved views are
  undesigned and reuse the open card; the rail follows age (the 24h / 72h
  rule) for unresolved cases, green for resolved, silver for withdrawn.
- The dashboard's complaints are the SAME portal-shaped list (the open ones,
  oldest first), so the dashboard and 06 cannot disagree.
- Attendance register (08) lives at /attendance/register and is ADMIN-ONLY,
  enforced on the server by requireRole("ADMIN") before any data is loaded (a
  Super Admin passes too; anyone else gets a plain notice). The nav's "Attendance" link
  stays on /attendance (07, the board). It reads REAL data and shows WHO ENTERED
  each record: see "The attendance register, screen 08". The earlier requirement
  to mark PERSONAL-device clock-ins is WITHDRAWN. Its sample data (and
  attendance.ts, Present / Absent) is REMOVED: "Absent" cannot be known from a
  copy of the book, so it says "No record". Figma's "◀ date ▶" is now a real
  From / To form with quick links.
- Screen 07 is now the TODAY BOARD (see "The today board" under "ATTENDANCE: HOW IT
  REALLY WORKS"). The old sample-driven "My Attendance" (its shift states, week
  table, totals, targets and the /attendance?scenario= switch) is REMOVED, with its
  sample data and TargetPercent. Figma frames 31:2 / 31:90 no longer describe it.
- The big clock (LiveClock) reads the shared useNow at minute granularity; it
  is the one use of the 100px display type (56px, capped at 14.3vw, on mobile).
- 08's department filters are derived from the data (A to Z, "No department"
  last), with computed counts. They
  are static (counts only, a TODO) and shown on mobile, wrapping, although
  the mobile frame omits the row: an admin on a phone keeps the breakdown.
  Same omission class as the missing mobile nav and complaints panel.
- Extension points on shared components (use these, never fork):
  Button aria-expanded, aria-controls and aria-label (a show / hide toggle);
  ClosePrompt different ("a different place": what "No" means); PhraseField
  (free text used before: the phrase twin of NameField);
  StatusPill compactOnMobile (dot-less 9px, short labels); StatTile dense
  and dot; PageHeader ledeSize="sm", className, --page-header-eyebrow-gap and
  --page-header-lede-gap; PersonCell --person-name-size, --person-sub-size,
  --person-sub-display, --person-gap; Avatar size="responsive"; Table
  --table-card-pad-x/-pad-y/-gap/-col-gap on an ancestor of the table.
  Screen CSS that overrides a shared cell's colour or size uses `.row .x`
  (two classes) so it wins regardless of stylesheet order.
- More extension points, built for the retired 07 sample screen (some are now unused): Card padding="xl" (40px, 24px on
  mobile); Button size="large" (the clock in / out action); StatusPill
  size="large", dotOnly (dot plus screen-reader label) and tone="neutral"
  (silver, "nothing to report yet"); Duration plusMs (a running total that
  ticks with the open shift); StatTile value and caption accept a live
  readout, and captions show on mobile except on dense tiles; Table
  --table-cell-min-height (default 40px); Table --table-layout (default fixed;
  auto when a card can be narrower than its fixed columns, see the divergences).
- More extension points, added for 06: StatusPill size="badge" (dot-less
  count) and onDark (white pill on burgundy); ComplaintAge until (a resolved
  case's age freezes at resolvedAt, neutral) and --complaint-age-weight (size
  by className, as before).
- Table has exactly TWO mobile layouts, chosen by mobileLayout: "cards"
  (03, 08) and "rules" (the retired 07 week list: ruled rows inside one card; now unused). If a
  THIRD mobile layout is ever needed, stop and tell the owner: the primitive
  is wrong, not short of another flag.
- Design colours that do not survive a contrast check, so far: status
  fills as text (green 3.30, amber 3.19; fixed by the ink tokens), smoke as
  text (2.75; fixed by the global smoke rule, informational text is dusk),
  the selected filter chip's gold count on burgundy (3.70; now white), and
  gold as text (2.93; the active nav link keeps gold but adds weight and an
  underline).

## Deliberate divergences from Figma

Where our tokens and the design conflict, our tokens win: one screen's card
looking different from every other card costs more than a couple of pixels
of fidelity. Recorded so nobody "fixes" them back:

- Stat tiles keep --fold-radius-card (12px) and the card shadow. 08's mobile
  frame draws a 10px radius and the subtle shadow; no such radius token
  exists.
- PageHeader keeps the shared 20/16 mobile padding. 08's mobile frame draws
  16/12.
- Mobile page titles are 36px everywhere (08's frame draws 32px).
- Mobile inputs are 16px, not 15px (iOS zoom on focus).
- Informational text is --fold-dusk, never --fold-smoke; the selected filter
  chip's count is white, not gold; status text on white uses the ink tokens.
- The design's "◀ date ▶" is rendered static, without the arrows.
- "On leave" is burgundy-steel everywhere. Figma's 07 draws it silver, a
  silver label on a silver fill (invisible, and unlike 08, which uses steel):
  drift, corrected here; the Figma file should be fixed at source.

## Decisions (owner)

- THE FEE GATE IS THE PORTAL'S, AND ONLY THE PORTAL'S. The PRD's FR-3.6 (an
  Admin PIN plus a reason overrides a release block) does NOT exist in CSS and
  must not be built. CSS reports what release-check told it and never
  overrides it. An admin who wants to release does it in the portal, where it
  is audited. Reason: the gate is what stops unpaid documentation fees being
  handed over, and a desk-level override makes it not a gate. The same
  thinking is why "unknown, do not release" is the answer while the gate is
  off, and why `handover.gate_answer` only ever records what the portal said.
- Stack: PostgreSQL via the plain `pg` driver, with SQL migration files. NO
  Prisma, NO Supabase (no Supabase Auth, no RLS), NO Tailwind. Roles are
  enforced in the application. Ask before any dependency beyond `pg` itself.
- Leave stays in CSS, minimal: dates and a kind (`leave`). Screen 08's ON LEAVE
  reads it.
- Enquiries (a non-client's, rule 3) are OPEN or CLOSED. No further workflow.
- Keep the `device` table (registered desk machines) and
  `handover.gate_answer`.
- NO PIN FLOW IS BUILT, and no PIN screen. There is no front-desk computer yet
  (it has not been bought), so there is no trusted desk device to validate a PIN
  on. Only the front desk and the owner ever sign in, by PASSWORD ONLY.
  `staff.pin_hash` and the `device` table stay in the schema, unused and empty,
  ready for the reception laptop. Do not build a PIN screen until that device exists.
- THE DEVICE COLUMNS (009) STAY, WITH A NEW MEANING. `attendance_record` stores
  the id and a SNAPSHOT of the KIND (DESK or PERSONAL) of the device the ENTRY was
  made on (the clock-in entry and the clock-out entry can differ). It is the front
  desk's own browser, never "where the staff member was". The kind is a snapshot,
  not a live lookup, so relabelling a device later never rewrites history (same
  reason as `visit.client_name_logged`). Migration 010 replaces the two
  constraints that assumed self-service: a record now ALWAYS has a
  `clock_in_entered_by` (renamed from `entered_by` in 011), and a missing
  device no longer needs a `correction_reason`.
- SUPERSEDED, WITHDRAWN: "screen 08 must visibly mark PERSONAL clock-ins". It is
  replaced by "screen 08 must show WHO ENTERED each record" (top of this file).
- THE TIGHTENING SWITCH, the `setting` row
  `attendance.clock_in_requires_desk_device` (value `false`), is moot while the
  front desk enters everything. It stays; NOTHING READS IT.

## Authentication

Password only (no PIN; see Decisions). CSS's own end to end: NOTHING on the
sign-in path calls the portal, so signing in works when the portal is down.
Files: `authPolicy.ts` (the numbers and pure rules), `password.ts` (scrypt),
`authCore.ts` (the rules), `authStore.ts` (SQL), `auth.ts` (Next glue: cookies,
redirects), `src/proxy.ts` + `proxyDecision.ts`, `staffAdmin.ts` + `scripts/create-staff.ts`.

- PASSWORDS: scrypt from `node:crypto`, N=32768, r=8, p=1, 64-byte key, 16-byte
  random salt, NFKC-normalised. Stored as
  `scrypt$N=32768,r=8,p=1,len=64$<salt b64url>$<hash b64url>`: the parameters
  are IN the string, so raising them later is done per user at their next
  sign-in (`needsRehash`), with no migration. Compared with `timingSafeEqual`.
  `maxmem` is derived from the parameters: they need 33,557,504 bytes and Node's
  default limit is 33,554,432, so scrypt THROWS without it. At most 2 hashes run
  at once (a 34 MB buffer each, on a shared host); beyond a short queue the
  answer is "busy". `DUMMY_HASH` (used for an email with no account) must be
  regenerated if `CURRENT_PARAMS` change; `password.test.ts` fails if not.
- A PLAINTEXT PASSWORD is never logged, returned, put in an error, a test name
  or a server action's result. The tests carry a canary for it.
- SESSIONS: a 32-byte random token (base64url); the database stores ONLY its
  SHA-256 (`session.token_hash`). Cookie `css_session`: httpOnly, sameSite=lax,
  path=/, Secure when `NODE_ENV === "production"` (a browser will not keep a
  Secure cookie that arrived over plain http, so it is off in development; it
  is decided from the environment, not hard-coded). ABSOLUTE lifetime 12 hours
  (`expires_at`, set from the DATABASE clock), IDLE timeout 3 hours
  (`last_seen_at`, refreshed at most once a minute). Past either, or revoked,
  or the person deactivated, the session is invalid. LOGOUT REVOKES THE ROW
  (`revoked_at`); clearing the cookie alone leaves a working token in the wild.
  Changing a password ends every session and issues a fresh one. `device_id`
  stays NULL until a device is registered.
- FAILED SIGN-INS: 5 failures in a row lock the account for 15 minutes
  (`password_failed_count`, `password_locked_until`); a success resets it. The
  update is ONE atomic statement, so simultaneous guesses cannot step over the
  limit; the failure that applies the lock restarts the count. The same message
  for a wrong password, an unknown address and an inactive account. TIMING
  PARITY: every attempt does exactly ONE scrypt run (a dummy hash when there is
  no account) and, on failure, exactly one write-shaped query (a no-op for an
  unknown or locked account). "Locked" must look the same for an address with no
  account, or locking would prove an account exists, so unknown addresses lock
  too (`SimulatedLockout`). Also a per-IP limit: 20 failures per 15 minutes,
  checked BEFORE any hashing (deliberately above 5: an office shares one
  address).
- LOGGING: a failed sign-in logs a reason and, only when the email matched a real
  account, the STAFF ID. NEVER the email that was typed, and no IP; nothing
  identifying when no account matched.
- WHERE THE GATES ARE. EVERY PAGE AND EVERY SERVER ACTION calls `requireSession()`
  (or `requireRole()`) itself, at the top, before it loads or asks for anything.
  A layout is NOT a gate (Next does not re-run it between pages in the layout,
  and a server action never passes through it). Roles come from `staff_role`;
  a Super Admin satisfies ADMIN, no other role implies another. Anything in the
  browser is a hint, never a gate. A new page or action that skips the call is a
  defect.
- THE PROXY (`src/proxy.ts`; Next 16 renamed middleware to proxy, and it runs on
  the Node.js runtime, not the edge) is only for cheap things: no cookie at all
  -> `/login?next=...`, and it forwards the path in `x-css-path`. It NEVER decides
  whether a session is valid and imports nothing that reaches the database.
- MUST CHANGE PASSWORD: a person with `must_change_password` reaches NOTHING but
  `/change-password` (every other page and action redirects them there) until
  they change it. After signing in, a person continues to where they were going
  (`safeNext`: a path on this site only; anything else becomes the dashboard).
- FIRST ACCOUNT / NEW ACCOUNTS: there is NO signup and there must never be one.
  `npm run staff:create -- --email ... --name "..." --department "..." --role ADMIN`
  (repeat `--role`); the password is typed at a prompt, twice, nothing echoed. It
  is never an argument (shell history, process list): the script refuses
  `--password`, and refuses a pipe. It works on the server over SSH or the cPanel
  terminal (PowerShell or Windows Terminal on Windows; Git Bash is not a TTY to
  Node). The account is created with `must_change_password`.
- UNDESIGNED, not in Figma: the change-password screen and the sign-out control
  (the avatar opens a small menu). Both are placeholders built from shared
  components; replace them when a design exists.
- KNOWN LIMITS (decide, do not forget): (1) The IP and unknown-address limiters are
  in this process's memory: several processes each keep their own, and a restart
  clears them. The per-ACCOUNT lock is in the database and holds. (2) The client
  address comes from `X-Forwarded-For` (the last entry, the one the proxy saw);
  confirm how the host presents it. (3) A lock means anyone who knows a staff
  email can lock that person out for 15 minutes by typing wrong passwords;
  there is no admin unlock yet (wait, or clear `password_locked_until`).
  (4) No password-reset flow: an administrator resets by a script yet to be
  written. (5) A DbError during sign-in shows its fixed message and a reference.

## Database

SQL migrations live in `db/migrations/`, applied in filename order, one logical
group per file, each in its own transaction. They target PostgreSQL 10.23 (end
of life, so plan an upgrade; they run unchanged on later versions) and need no
extension. 001-010 have been applied to the LOCAL dev database (PostgreSQL 18); 001-009
are reported applied on the cPanel server (010 is pending, applied outside these
sessions, never by Claude). The files have NOT been verified on PostgreSQL 10 by us: a local pass proves syntax and
logic, not PG10 compatibility. How to create, apply and reset the local database
is in `db/README.md`. Claude never touches the cPanel server. What deploying CSS needs (the
environment variables, the cPanel launcher STRIPPING DOUBLE QUOTES from them, the migrations the
server still needs, what is not known) is in `docs/DEPLOY.md`: keep it current. CSS is built as Next STANDALONE
output (`npm run build:standalone`) and started by `deploy/app.js` (cPanel's startup file; port
and host from the environment, never `HOSTNAME`). The build leaves out `.next/static` and
`public`, which the assembly copies in; a page without them is unstyled. The public name
`frontdesk.graceonlyestates.com` is in `next.config.ts` (`serverActions.allowedOrigins`) so
forms work behind a proxy that rewrites Host: a change of domain changes that line.
`scripts/shots-tls.ts` proves it behind a TLS-terminating proxy.
BUILDS USE WEBPACK, NEVER TURBOPACK: A HOST CONSTRAINT, NOT A PREFERENCE. The cPanel host's
glibc is older than 2.29, so Next's native SWC (`@next/swc-linux-x64-gnu`) cannot load there;
Next falls back to the WASM SWC bindings, and Turbopack refuses to run without native bindings.
Every build is `next build --webpack` (`NEXT_BUILD_ARGS` in `scripts/build-standalone.mjs`, used
by `npm run build`, `build:standalone` and the screenshot runner): ONE build path, so what is
checked locally is what ships. Anyone who "modernises" the build back to Turbopack breaks the
deploy. Any dependency needing a newer glibc fails on this host the same way: one more reason
the dependency list stays small. (`npm run dev` is the owner's dev server, not a build; no check
runs against it.)
`db/pg10-proof.sql` is all the migrations joined into one file to carry to the
PG10 server. It is GENERATED (`npm run db:proof`) and is NOT a migration: never
put it in `db/migrations/`, never edit it, and regenerate it (and commit both)
after ANY change to `db/migrations/` (a new file; or an edit, which is only
allowed before the first server apply). `npm run db:proof:check` fails if it is stale.
The server took the proof file ONCE (001-009) and NEVER takes it again. Later migrations go
to it as a GENERATED PENDING FILE: `db/pending-010-016.sql` (`npm run db:pending`,
`db:pending:check`; `db/build-pending.mjs`, sharing `db/bundle.mjs` with the proof builder),
010 to 016 verbatim with the same markers and line ranges, applied once on top of 001-009 and
proven to give the same schema as the sixteen files. Not a migration; never in
`db/migrations/`. The next one covers what comes after 016.

- MIGRATIONS ARE APPEND-ONLY. AFTER THE NEXT SERVER APPLY, `db/migrations/` IS
  APPEND-ONLY WITH NO EXCEPTIONS: a change to the schema is a NEW numbered
  migration, never an edit to an applied one. Applied history is what the
  server ran; rewriting it makes the files lie about the database. ONE
  exception was made, once, and is closed: `005_attendance.sql` was edited
  (the `setting` key format and the four seeded keys) after it had been applied
  to the server but before the schema carried anything: no application
  connected to it, it held no data, nothing read it, and it was being dropped and
  re-applied anyway. Fixing it at the source also left `009` purely additive,
  with no `DROP CONSTRAINT`/`ADD CONSTRAINT` of the same name (the construct in
  it most likely to trouble PG10). The exception does not repeat.
  `010_roster_movements_backdating.sql` is the FIRST migration written under the
  closed rule. It reshapes attendance (see "ATTENDANCE: HOW IT REALLY WORKS") by
  DROPPING two constraints of 005/009 (new names are used, nothing is re-added
  under an old name) and adding columns and a table. The cPanel server already
  has 001-009, so it receives 010 to 016 (one file at a time), never
  `pg10-proof.sql` (that file is for a FRESH database and re-creates everything).
  Applying them there is done outside this repo's sessions.
  010 leaves two rules to the APPLICATION, each commented in the migration: a
  movement lies inside its shift, and a record created for an earlier Lagos day
  carries `backdate_reason`.
  `011_entered_by_per_event.sql` renames `attendance_record.entered_by` to
  `clock_in_entered_by`, adds `attendance_record.clock_out_entered_by` and
  `movement.returned_recorded_by` (each present exactly when its time is).
  `012_movement_entered_by_names.sql` then renamed movement's two author columns to
  `left_entered_by` and `returned_entered_by` (and their constraints) to match. The
  server receives 010 to 015 together, outside these sessions.
  `013_signout_missing.sql` adds the third attendance state, "closed but never signed
  out" (`signout_missing_at`, `signout_missing_by`; never with a clock-out time) and
  rebuilds `attendance_one_open_shift_key` to exclude it. The server receives 010 to
  013 together, one file at a time, outside these sessions.
  `014_corrections.sql` adds `corrected_at`/`corrected_by` (with the existing
  `correction_reason`: all three or none) and `voided_at` (a removed record), and rebuilds
  `attendance_one_open_shift_key` again to exclude removed records. The server receives
  010 to 014, one file at a time.
  `015_movement_corrections.sql` gives `movement` the same correction columns
  (`correction_reason`, `corrected_at`, `corrected_by`: all three or none) and `voided_at`
  (a removed movement), and rebuilds `movement_one_open_key` to exclude removed movements.
  The server receives 010 to 015, one file at a time.
  `016_late_threshold_snapshot.sql` adds `attendance_record.late_after_local`, the late threshold
  in force when the record was entered (`attendance_late_after_local_format_check`: NULL or
  HH:MM), backfilled from the setting as it is now (NULL if unreadable). The server receives 010
  to 016, one file at a time. 016 was verified from the top and old-then-new (also with an
  unreadable setting) in throwaway schemas, and applied to the local `public` schema.
- NEVER DROP OR RECREATE THE LOCAL `public` SCHEMA (STANDING RULE). It holds the
  owner's real local login, whose password was typed at a prompt and cannot be
  recreated, and his sessions. Verify migrations in THROWAWAY schemas inside the
  same database (`CREATE SCHEMA shot_x`; apply with
  `PGOPTIONS="-c search_path=shot_x"`; drop the scratch schema afterwards): both
  "all from the top" and "the old ones, then the new one alone". Then apply the new
  migration ON TOP of the real schema. This overrides "Start over" in
  `db/README.md`, which is for the owner to run, never Claude.
- SETTING KEYS are `<domain>.<name>`: exactly one dot, lower snake case within
  each part, and the domain is the area of the app the setting governs
  (`attendance`, later `visits`, `complaints`, ...). Enforced by
  `setting_key_format_check`, so a flat key such as `late_after_local` is
  rejected. Current keys: `attendance.late_after_local`,
  `attendance.weekly_target_minutes`, `attendance.monthly_target_minutes`,
  `attendance.office_ip_allowlist`, `attendance.clock_in_requires_desk_device`.
  A setting is read by the application; a dropdown list is not a setting, it is
  a lookup table.
- UUID primary keys come from `crypto.randomUUID()` in the app; no DEFAULT,
  because `gen_random_uuid()` does not exist on 10. Only `audit_log` uses an
  identity column.
- Every time is `timestamptz` and defaults to `now()` (the database is the one
  clock). Office zone is Africa/Lagos: compute day boundaries with
  `AT TIME ZONE 'Africa/Lagos'`; never store a local timestamp. The only `date`
  columns are leave days.
- No generated columns (12+) and no ENUM types (adding a value cannot run in a
  transaction before 12). Controlled lists are lookup tables with foreign
  keys; a new value is an INSERT, not a migration.
- Triggers use `EXECUTE PROCEDURE` (`EXECUTE FUNCTION` is 11+).
- Append-only tables (`audit_log`, `visit_event`, `handover`,
  `handover_item`) are guarded by a trigger AND must be granted to the
  application role without UPDATE, DELETE or TRUNCATE (a deployment step).
- HARD RULE, DATABASE ERRORS. Two lists, and they are different:
  - NEVER OUT, NEVER LOGGED: a PostgreSQL error's `message`, `detail`, `hint`,
    `where`, and the RAW ERROR OBJECT itself (also its `column`, `schema`,
    `dataType`, and the connection details a network error carries: host,
    address, user). A failing-row `detail` contains the row (visitor and client
    names, `client_name_logged`), and a connection error's message can contain
    the host and user. Never in a response, never shown, never in `console`,
    log files, error pages, server action results, API responses or test output.
  - SAFE TO LOG, NEVER RETURNED TO A USER: the SQLSTATE code, the CONSTRAINT
    NAME, the TABLE name, and the app's error id. A constraint name is an
    identifier we chose and carries no visitor or client data; it is the most
    useful thing for diagnosing a failure. These are logged (by the database
    layer only) and are not put in anything a user sees.
  The database layer (`src/lib/db.ts`) catches every `pg` error at one boundary
  and maps it to a fixed, app-controlled message, keyed by CONSTRAINT NAME (by
  table and column for a NOT NULL violation, which has no constraint, and by
  SQLSTATE class for errors with neither). What leaves the layer is the mapped
  message, an error KIND and optional FIELD (both constants from the mapping
  table, never taken from the error) and an error id. The id is generated by
  the app and is not derived from the error; the raw error is kept nowhere to
  look it up by. An error with no mapping gets a generic "something went wrong"
  message plus the id, never the raw text. It is the database twin of "never log
  a response" for the portal client.
- THE DATABASE LAYER is `src/lib/db.ts`, the ONLY module that imports `pg` or
  opens a connection (the database twin of `portal.ts`). Server-only; it throws
  if it is ever loaded in a browser. `DATABASE_URL` is read when the pool is
  first needed, never at module scope, and is never logged, returned or put in
  an error.
  - Use `query(sql\`...\`)` and `transaction(async (tx) => ...)`. `query()`
    accepts only a `Statement`, and the only way to make one is the `sql` tag,
    where every `${value}` becomes a numbered parameter. NEVER build SQL text
    from a string; the types refuse it and so does the runtime.
  - Failures are thrown as `DbError` (`kind`, `field`, `errorId`, a fixed
    `message`). `isInputError(e)` means "the person can fix it" (a form
    screen); anything else is the database being unable to work (an error
    screen). A `transaction` rolls back and releases its connection on every
    path; an error the callback throws itself is rethrown untouched.
  - The mapping from constraint to message is `src/lib/dbConstraints.ts`. EVERY
    constraint, unique index and primary key in `db/migrations/` is either
    mapped (a person can trip it: it has a message) or listed untrippable (with a
    reason). `dbConstraints.test.ts` derives the list from the migration files
    and FAILS if a new constraint is in neither: a migration that adds a
    constraint must also add its entry. A NOT NULL column has no constraint name
    on PG10, so it is mapped by `table.column`.
  - POOL: at most 5 connections, a 5 s connection timeout, a 10 s idle timeout,
    a 15 s server-side `statement_timeout` and `idle_in_transaction_session_timeout`.
    The pool is small on purpose: this is SHARED cPanel PostgreSQL, where
    `max_connections` is server-wide and not ours to take. Raising a number is a
    decision about a shared server, not a performance knob.
  - A `date` column comes back as the string "YYYY-MM-DD", never a `Date`;
    `timestamptz` comes back as a `Date`. UUIDs are made by the caller with
    `crypto.randomUUID()`.
  - LAGOS DAYS: `src/lib/lagosTime.ts` is the one place that converts a Lagos
    calendar day to a range of instants (`lagosDayRange`, `lagosDaysRange`,
    `lagosDateOf`). Query with `clock_in_at >= ${range.start} AND clock_in_at <
    ${range.end}`. Never cast, truncate or use `AT TIME ZONE` in an application
    query, and never use the server's local time.
- EVERY CHECK, UNIQUE and composite FOREIGN KEY constraint is named explicitly
  in the migration (`CONSTRAINT <name>`), never auto-named: an auto-name carries
  a number assigned in declaration order, so adding a check renumbers the rest
  and silently breaks the error mapping above. Shape:
  `<table>_<rule>_check` (`_key` for unique, `_fkey` for foreign keys), lower
  snake case, naming the RULE and not the column list, under 63 characters
  (PostgreSQL truncates longer names). A name is part of the application's
  contract: renaming one is a change to the error mapping, made in the same
  commit.
- There is NO client table. A visit stores `portal_client_id` and
  `client_name_logged` only. The name is the ONE deliberate copy of portal data
  (a signature in a visitor book): it is never refreshed, and screen 05 shows
  the live portal name.
- Composite foreign keys enforce rules 2 and 3 in the database: an `enquiry`
  can only belong to a non-client's visit, and `visit_case_link` and
  `case_request` can only belong to a client's.
- NEVER STORED: any portal client data (email, balances, fee status, purchases,
  estate, document lists, case content, status or age); raw portal responses;
  search queries; complaints or their messages; derived values (elapsed time,
  visit status, attendance state, durations, totals, KPIs); plaintext
  passwords or tokens (hashes only); staff phone, address or salary.
- Attendance is the front desk's COPY of the paper book. It proves what the
  front desk TYPED (`clock_in_entered_by` / `clock_out_entered_by` say who), not that the person was present; the
  paper is the record. Label it so.
- TODO (portal owner): the create-case endpoint should accept CSS's idempotency
  key (`case_request.id`), record a `source_ref` (the CSS visit id) and offer a
  dedupe lookup of a client's open cases. Until then `008_case_links` is inert.

## Scope against the PRD ("CSS PRD.docx")

The PRD is the original spec. It and the built screens diverge in three ways.
This is the honest scope picture; update it as items are built or dropped.

PRD requirements the eight screens do NOT cover (six; none is built):

1. Document release: recording a handover (6.2, FR-3.1 to 3.5) and its history.
   Schema exists (`007_handovers`). The gate is the portal's (see Decisions).
2. Complaint lodging and the admin workflow (6.3, FR-2): lodge mid-visit,
   status moves, internal notes, reply to the complainant, and the emails to
   admin. 06 is a read-only list. These go through the portal's case endpoints
   (not built); who sends the emails is undecided now that the portal owns
   complaints.
3. Onboarding Assist (6.4, FR-5): the side-pane portal sign-up and the signup
   webhook. The portal exposes no phone number and has no such webhook.
4. Acting on visits (6.1, 6.5, FR-1): Check in, Check out, the 15-minute edit
   window, adding notes, a final note at check-out. The buttons exist and are
   wired to nothing.
5. Looking back and reporting (FR-1, FR-6): a Completed visits history (03 is
   Active only), visitor frequency, document volumes, CSV export.
6. Super Admin (FR-7): user management screens, dropdown management and the
   audit log viewer. (Sign-in, sessions and the four roles ARE built: see
   "Authentication". Accounts are made from the command line.)

Built but NOT in the PRD: STAFF ATTENDANCE, all of it (07 My Attendance, 08
Attendance Register, clock in/out, departments, leave, the 09:15 late rule,
hour targets, the timesheet export). Schema: `005_attendance`, reshaped by `010`
(roster people, the movement book, back-dating) to match how attendance really
works: see "ATTENDANCE: HOW IT REALLY WORKS" (batch entry by the front desk from
a paper book; staff never sign in).

PRD points that CONFLICT with settled decisions (not followed):

1. Complaints in CSS tables (Complaint, ComplaintMessage). The portal owns
   them (rule 2); CSS has no complaint tables.
2. PortalSnapshot caching balances on disk. CSS never caches client data to
   disk, and the portal refuses property balance and receipt on purpose. The
   only money is the documentation fee.
3. The fee-gate override with an Admin PIN (FR-3.6). Not built, by decision.

Also not followed: phone-based lookup and reconciliation (the portal has no
phone number; lookup is by name), Realtor lookup (the portal has client
endpoints only, so a Realtor is a non-client here), the PRD's complaint
categories and three statuses (the portal's ten types and five statuses
apply), the PRD's stack (Supabase, Prisma, Tailwind, Vercel, dark mode,
Playfair and Poppins), and "Existing" versus "New" as visitor types (that is
`visit.lookup_outcome`).

## Screens — all eight exist in Figma, desktop + mobile

01 Login                      23:2   / mobile 23:50
02 Dashboard                  24:2   / mobile 24:125
03 Active Visits              26:2   / mobile 26:147
04 New Visit                  27:2   / mobile 27:59
05 Visit Detail               28:2   / mobile 28:80
06 Complaint Queue            29:2   / mobile 29:62
07 Today board (front desk)   NOT in Figma (the old 31:2 / 31:90 "My Attendance" is retired)
08 Attendance Register (admin) 32:2  / mobile 32:168

## Working rules

- VISUAL CHECKING (amended rule). A BOUNDED run is allowed and expected: one
  command that starts the app, does its checks, and shuts it down before
  returning, leaving no process behind. A server LEFT ALIVE in a background shell
  is still forbidden. The owner runs the dev server himself on the default port
  (3000); nothing started for a check may collide with it or outlive its command.
  - `npm run shots:account` (once) makes a LOCAL-ONLY screenshot account; its
    credentials are CSS_SHOT_EMAIL / CSS_SHOT_PASSWORD in `.env.local`, never in
    the repo or a picture. It REFUSES to run unless DATABASE_URL is localhost
    (`src/lib/localDatabase.ts`, checked before the database layer loads and again
    against the server's own address). Never loosen that guard.
  - `npm run shots [-- /path ...]` builds, ASSEMBLES THE STANDALONE OUTPUT and starts it
    as cPanel will (`node .next/standalone/app.js`, PORT and HOST from the environment) on port
    3457, signs in, captures each page at desktop (1280) and phone (390) into
    `screenshots/` (git-ignored, never committed), and stops the server on every
    exit path. It fails on any console error, page error, failed or 4xx/5xx
    request, or sideways scroll. Run it from PowerShell: Git Bash rewrites a
    leading `/path` argument into a Windows path.
  - Any change to a screen ends with capturing it at both widths and READING the
    images before reporting: say what was looked at and what was seen. A clean
    screenshot proves layout, not behaviour: it never shows a button is wired.

- Never commit secrets. The portal service key lives in the environment.
  - The variables are CSS_PORTAL_BASE_URL and CSS_PORTAL_SERVICE_KEY (the key
    is `<id>.<secret>`). NOTE: the portal repo's key-generation script labels
    the same value CSS_PORTAL_KEY. The two repos use different names; copy
    the VALUE, not the name. Mixing them up cost a debugging round.
  - src/lib/portal.ts is the only module that calls the portal; it is
    server-only. `npm run portal:health` and `npm run portal:try -- search
    <name>` (read-only, one GET each) exercise it; neither prints the key.
- Never run destructive git commands. Stage by explicit path, never
  `git add -A` and never `git add .`.
  - Commit messages carry NO Co-Authored-By line (owner's decision). This
    overrides any tool default. Earlier commits up to 9d5ffb4 have one; they
    are left as they are (history is not rewritten).
  - Ask before adding a dependency. `pg` is the one approved database
    dependency (see Decisions); nothing beyond it without asking.