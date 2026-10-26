-- Seeds VISITS into the THROWAWAY schema shot_e2e for scripts/shots-visits.ts. LOCAL ONLY.
-- Run AFTER scripts/shots-arrivals.seed.sql (it needs the screenshot account in shot_e2e):
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f scripts/shots-visits.seed.sql
-- Never the real `public` schema. AT TIME ZONE appears only because this is a test seed.
--
-- Not a clean log:
--   * Tunde Afolabi (Realtor): checked in TWO DAYS AGO and never checked out (forgotten).
--   * Bola Ade (Visitor, phone on file): came YESTERDAY, checked in and out. Today the desk
--     types his number again under another spelling: CSS must ask "is this Bola Ade?".
--   * Grace Eke (Investor, organisation, phone): today, checked in and out, and CORRECTED
--     (the check-in time, by a second front-desk person, with a reason).
--   * "Wrong Entry": today, REMOVED (a void), with a reason.
--   * Kingsley Eze: a CLIENT (MATCHED, portal id the stand-in portal knows), in now.
-- Today's times are a few minutes after midnight, so they are in the past at any hour of a run.

CREATE TEMP TABLE seed_today AS
  SELECT (now() AT TIME ZONE 'Africa/Lagos')::date AS d;
CREATE TEMP TABLE seed_desk AS SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost';

-- A second front-desk person: who typed what must show by name.
INSERT INTO shot_e2e.staff (id, full_name, department) VALUES ('7a1e0000-0000-4000-8000-00000000c0de', 'Kemi Lawal', 'Front desk');

INSERT INTO shot_e2e.visitor (id, display_name, organisation, phone, consent_at, created_by) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Tunde Afolabi', 'Prime Homes', NULL, now() - interval '2 days', (SELECT id FROM seed_desk)),
  ('b0000000-0000-4000-8000-000000000002', 'Bola Ade', NULL, '+2348035550000', now() - interval '1 day', '7a1e0000-0000-4000-8000-00000000c0de'),
  ('b0000000-0000-4000-8000-000000000003', 'Grace Eke', 'Eke Holdings', '+2348035551111', now(), (SELECT id FROM seed_desk)),
  ('b0000000-0000-4000-8000-000000000004', 'Wrong Entry', NULL, NULL, now(), (SELECT id FROM seed_desk));

-- Tunde: two days ago, 16:10, still open.
INSERT INTO shot_e2e.visit (id, visitor_type_code, reason_code, visitor_id, lookup_outcome, to_see, checked_in_at, checked_in_by)
SELECT 'c0000000-0000-4000-8000-000000000001', 'REALTOR', 'SCHEDULED_MEETING', 'b0000000-0000-4000-8000-000000000001', 'NOT_LOOKED_UP',
       'Sales', ((d - 2)::timestamp AT TIME ZONE 'Africa/Lagos') + interval '16:10', (SELECT id FROM seed_desk)
  FROM seed_today;

-- Bola: yesterday 14:00 to 14:40, checked in by Kemi and out by the screenshot account.
INSERT INTO shot_e2e.visit (id, visitor_type_code, reason_code, visitor_id, lookup_outcome, checked_in_at, checked_in_by,
                            checked_out_at, checked_out_by, close_reason)
SELECT 'c0000000-0000-4000-8000-000000000002', 'VISITOR', 'INQUIRY', 'b0000000-0000-4000-8000-000000000002', 'NOT_LOOKED_UP',
       ((d - 1)::timestamp AT TIME ZONE 'Africa/Lagos') + interval '14:00', '7a1e0000-0000-4000-8000-00000000c0de',
       ((d - 1)::timestamp AT TIME ZONE 'Africa/Lagos') + interval '14:40', (SELECT id FROM seed_desk), 'NORMAL'
  FROM seed_today;

-- Grace: today 00:05 to 00:50, corrected by Kemi.
INSERT INTO shot_e2e.visit (id, visitor_type_code, reason_code, visitor_id, lookup_outcome, to_see, checked_in_at, checked_in_by,
                            checked_out_at, checked_out_by, close_reason, corrected_at, corrected_by, correction_reason)
SELECT 'c0000000-0000-4000-8000-000000000003', 'INVESTOR', 'SCHEDULED_MEETING', 'b0000000-0000-4000-8000-000000000003', 'NOT_LOOKED_UP',
       'Peter Obi', (d::timestamp AT TIME ZONE 'Africa/Lagos') + interval '00:05', (SELECT id FROM seed_desk),
       (d::timestamp AT TIME ZONE 'Africa/Lagos') + interval '00:50', (SELECT id FROM seed_desk), 'NORMAL',
       (d::timestamp AT TIME ZONE 'Africa/Lagos') + interval '00:55', '7a1e0000-0000-4000-8000-00000000c0de', 'the book says 00:05'
  FROM seed_today;

-- Wrong Entry: today 00:20, removed.
INSERT INTO shot_e2e.visit (id, visitor_type_code, reason_code, visitor_id, lookup_outcome, checked_in_at, checked_in_by,
                            corrected_at, corrected_by, correction_reason, voided_at)
SELECT 'c0000000-0000-4000-8000-000000000004', 'VISITOR', 'INQUIRY', 'b0000000-0000-4000-8000-000000000004', 'NOT_LOOKED_UP',
       (d::timestamp AT TIME ZONE 'Africa/Lagos') + interval '00:20', (SELECT id FROM seed_desk),
       (d::timestamp AT TIME ZONE 'Africa/Lagos') + interval '00:21', '7a1e0000-0000-4000-8000-00000000c0de', 'typed twice',
       (d::timestamp AT TIME ZONE 'Africa/Lagos') + interval '00:21'
  FROM seed_today;

-- Kingsley Eze: a client, today 00:30, in now.
INSERT INTO shot_e2e.visit (id, visitor_type_code, reason_code, portal_client_id, client_name_logged, lookup_outcome, to_see,
                            checked_in_at, checked_in_by)
SELECT 'c0000000-0000-4000-8000-000000000005', 'CLIENT', 'DOCUMENT_COLLECTION', 'a1b2c3d4-0000-4000-8000-00000000e2e0', 'Kingsley Eze',
       'MATCHED', 'Legal', (d::timestamp AT TIME ZONE 'Africa/Lagos') + interval '00:30', '7a1e0000-0000-4000-8000-00000000c0de'
  FROM seed_today;
