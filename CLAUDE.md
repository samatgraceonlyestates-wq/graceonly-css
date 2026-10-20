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
4. The portal API that CSS reads is READ-ONLY and authenticated with a
   service key sent in the X-Service-Key header. CSS never touches the
   portal database directly.
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

Spacing scale: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 24 · 28 · 32 · 40
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
  everyone. TODO: role gate; roles are not built yet.
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
- Attendance register (08) lives at /attendance/register and is ADMIN-ONLY;
  the role gate is a TODO (roles are not built). The nav's "Attendance" link
  stays on /attendance (07, a person's own attendance).
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
- Never run destructive git commands. Stage by explicit path, never
  `git add -A` and never `git add .`.
  - Ask before adding a dependency.