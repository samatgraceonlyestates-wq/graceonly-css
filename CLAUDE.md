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
--fold-smoke:           #ae969b   /* placeholder text, muted */
--fold-silver:          #d9cdd0   /* borders, table rules */
--fold-mist:            #ede4e1   /* avatar and panel fills */
--fold-canvas:          #f9f8f6   /* page background, input fills, chips */
--fold-white:           #ffffff   /* cards, nav, table surfaces */
--fold-status-green:    #16a34a   /* on track */
--fold-status-amber:    #d97706   /* long */
--fold-status-red:      #dc2626   /* overdue */

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

Radii:   4px small marks · 7px logo mark · 12px cards · 18px avatars
         24px floating nav · 9999px pills, inputs, buttons

Shadows (all tinted burgundy, never grey):
  subtle  0 1px 4px  rgba(128,0,32,0.10)
  nav     0 6px 16px rgba(128,0,32,0.12)
  card    0 9px 25px rgba(128,0,32,0.12)

Spacing scale: 4 · 6 · 8 · 12 · 16 · 24 · 32
Card padding 32px; table card 20px top / 24px sides / 24px bottom.
Table rows: 14px vertical padding, 16px column gap, 1px silver bottom rule.

## Component vocabulary

- Button, primary: burgundy fill, white text, 16px semibold, full pill,
  24px/14px padding, subtle shadow.
- Button, row action: white fill, 1.5px burgundy-steel border,
  burgundy-steel text, 12px semibold, 32px tall, pill.
- Input: canvas fill, 1px silver border, 48px tall, pill, 16px text,
  smoke placeholder. Label above it in 10px uppercase dusk.
- Chip / tag: canvas fill, 10px uppercase dusk label, pill, 10px/4px.
- Status pill: status colour, dot + 10px uppercase label, pill, 10px/4px.
- Avatar: 36px, mist fill, burgundy initial, 18px radius.
- Card: white, 12px radius, card shadow.
- Floating nav: white, 24px radius, nav shadow, 24px/14px padding.

UNRESOLVED — do not guess: the Figma export gives the status pill the same
colour for its fill and its text, which cannot be right. Open the Figma
file and read the actual fill opacity and text colour before building the
pill. Ask if it is still unclear.

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