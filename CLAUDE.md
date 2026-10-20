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
  stays on /attendance (07, a person's own attendance). TODO when it reads real
  data: it must visibly mark clock-ins from a PERSONAL device (see Decisions);
  the sample data has no device kind yet.
- 08's date control is a STATIC label. Figma draws "◀ Fri 16 Oct 2026 ▶" as
  one text layer with no component and no prototype link (0 interactions in
  either frame). It is rendered without the arrows, since arrows would
  promise a day stepper; a real stepper needs a date in the route and
  per-date data. On mobile the date is the line under the title.
- Attendance state is derived, never stored: on leave, else absent (no
  clock-in), else late (clock-in after the late-after instant, 09:15 in the
  design), else present. The KPI tiles are counted from the data. Sample
  data has 24 staff (9 from the design, 15 placeholders) so the totals are
  19 / 3 / 1 / 1; durations tick on the shared interval (Duration).
- The sample attendance day is ANCHORED TO now, like the visits list: each
  clock-in is now minus its design duration, so every duration equals the
  design's and none is ever in the future or clamped to 0h 00m. Clock-in
  times of day therefore move with now, and the sample's late line moves
  with them (same offset from the day's start as 09:15 has from 10:42), so
  the "after HH:MM" caption is computed. Real data uses the fixed 09:15 rule.
- My Attendance (07) lives at /attendance (the nav's "Attendance" link). Its
  shift has THREE states, derived by shiftState from one record (clock-in and
  clock-out): not clocked in, on shift, shift complete. Figma draws only
  on-shift; the other two reuse the same layout and are undesigned. No break
  state exists. The lede copy is per state: the design's "Clock in to start
  the day..." line is the not-clocked-in one; "You're on shift..." and
  "You've clocked out for today..." are new. Clock in / Clock out render
  enabled and wired to nothing (TODO, no backend); a complete shift has no
  action.
- 07's record for today is the SAME one 08 shows for the same person (Sam
  Okonkwo): one source in sampleData.ts. TODO: /attendance?scenario=
  not-clocked-in|on-shift|complete is a SAMPLE-ONLY preview switch so all
  three states can be seen; the other two deliberately disagree with 08. It
  is honoured only when NODE_ENV !== "production"; a production build never
  reads the query string. Remove it when the attendance backend exists.
- 07's week rows are the real Mon to Fri of the current week, computed from
  the calendar: earlier days are sample history, today is live, later days
  are empty. NOTE: the Figma frame's week table is off by one day against
  its own clock. The clock says "Friday, 16 October 2026" (a Friday), but the
  table runs "Monday 13 ... Thursday 16 ... Friday 17 (today)".
- 07's week total, month total and the percentage all tick with the open
  shift (Duration plusMs, TargetPercent, on the shared interval). Targets
  (40h, 160h) and the earlier-weeks month base are placeholders. Late days
  is counted from the week. The mobile frame shows only the week total (in
  the card title); Month total and Late days are kept, stacked under the
  week card, like the other mobile omissions.
- The big clock (LiveClock) reads the shared useNow at minute granularity; it
  is the one use of the 100px display type (56px, capped at 14.3vw, on mobile).
- 08's department filters are derived from the staff data, in order of first
  appearance (so HR appears, unlike the design), with computed counts. They
  are static (counts only, a TODO) and shown on mobile, wrapping, although
  the mobile frame omits the row: an admin on a phone keeps the breakdown.
  Same omission class as the missing mobile nav and complaints panel.
- Extension points on shared components (use these, never fork):
  StatusPill compactOnMobile (dot-less 9px, short labels); StatTile dense
  and dot; PageHeader ledeSize="sm", className, --page-header-eyebrow-gap and
  --page-header-lede-gap; PersonCell --person-name-size, --person-sub-size,
  --person-sub-display, --person-gap; Avatar size="responsive"; Table
  --table-card-pad-x/-pad-y/-gap/-col-gap on an ancestor of the table.
  Screen CSS that overrides a shared cell's colour or size uses `.row .x`
  (two classes) so it wins regardless of stylesheet order.
- More extension points, added for 07: Card padding="xl" (40px, 24px on
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
  (03, 08) and "rules" (07's week list: ruled rows inside one card). If a
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
- 07's mobile week card is 24px padded (the shared Card), not Figma's 20px.
- 07's week table is FLUID (Table --table-layout: auto), not Figma's fixed pixel
  columns. Figma 31:2 draws the Status column at x=584 inside a 568px inner
  width, i.e. OUTSIDE its own card; copied as fixed widths (584px in total) the
  table overflowed the card and its row rules ran out into the gap beside the
  totals. Only the Day column keeps a width (196px). The body grid is also Figma's
  616:568 split (31:27 / 31:77), not two equal halves. Fix the Figma file at source.

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
  on. Staff authenticate by PASSWORD ONLY, from their own phones. `staff.pin_hash`
  and the `device` table stay in the schema, unused and empty, ready for the
  reception laptop. Do not build a PIN screen until that device exists.
- ATTENDANCE IS RECORDED, NOT BLOCKED, FROM ANY DEVICE. Because staff log in
  from their own phones, a clock-in can happen from anywhere, including bed.
  That is not blocked (the hardware does not exist); it is RECORDED and made
  VISIBLE. `attendance_record` stores the id and a SNAPSHOT of the KIND (DESK or
  PERSONAL) of the device that clocked in and of the device that clocked out
  (they can differ). The kind is a snapshot, not a live lookup, so relabelling a
  device later never rewrites history (same reason as `visit.client_name_logged`).
  A record with no clock-in device must be a manual entry carrying a
  `correction_reason`, so a missing device cannot pass for a real clock-in.
- SCREEN 08 (Attendance Register) MUST VISIBLY MARK any clock-in whose recorded
  device kind is PERSONAL. Not hidden, not blocked, not styled as an error:
  visible, so a manager reading the register knows which entries mean "was in
  the office" and which do not. The exact treatment is a later design question;
  the requirement is that it cannot be invisible. The same goes for a clock-out
  from a PERSONAL device, and for a manual entry (no device, has a reason).
- THE TIGHTENING SWITCH is the `setting` row
  `attendance.clock_in_requires_desk_device` (value `false`). When the reception
  computer is bought and registered as a DESK device, setting it to `true` is how
  phone clock-in gets refused: an UPDATE of that row, no code change, no
  migration. NOTHING READS IT YET.

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
extension. They have been applied to the LOCAL dev database only (PostgreSQL 18)
and have NOT been run on a PostgreSQL 10 server: a local pass proves syntax and
logic, not PG10 compatibility. How to create, apply and reset the local database
is in `db/README.md`. Nothing has been applied to the cPanel server.
`db/pg10-proof.sql` is all the migrations joined into one file to carry to the
PG10 server. It is GENERATED (`npm run db:proof`) and is NOT a migration: never
put it in `db/migrations/`, never edit it, and regenerate it (and commit both)
after ANY change to `db/migrations/` (a new file; or an edit, which is only
allowed before the first server apply). `npm run db:proof:check` fails if it is stale.

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
- Attendance proves that someone AUTHENTICATED (by password, today from their own
  phone), not that they were physically present. Label it so. The device KIND
  recorded on each clock-in (see Decisions) is what tells a manager whether an
  entry can mean "was in the office".
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
hour targets, the timesheet export). Schema: `005_attendance`.

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
07 My Attendance (staff)      31:2   / mobile 31:90
08 Attendance Register (admin) 32:2  / mobile 32:168

## Working rules

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