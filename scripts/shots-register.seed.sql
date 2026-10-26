-- A MESSY MONTH for scripts/shots-register.ts (screen 08 on real data). LOCAL ONLY, THROWAWAY
-- schema shot_e2e. Run AFTER scripts/shots-arrivals.seed.sql, scripts/shots-board.seed.sql and
-- scripts/shots-movements.seed.sql (it needs their account, roster and today's records):
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f scripts/shots-register.seed.sql
-- It writes only days 3 to 26 days ago, so it never collides with the board seeds (today,
-- yesterday, two days ago). Not a clean month: shifts with no sign-out, one never closed,
-- removed records (which must count for nothing), corrections, a restore, back-dated entries,
-- self-approved movements, two front-desk people typing, leave, a person with no department,
-- and a LATE setting of 09:00 instead of 09:15 (the register must read the setting).
-- AT TIME ZONE appears only because this is a test seed.

CREATE TEMP TABLE seed_today AS
  SELECT (now() AT TIME ZONE 'Africa/Lagos')::date AS d;
CREATE TEMP TABLE seed_actor AS SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost';

-- A second front-desk person (no login needed to be named as the one who typed something).
INSERT INTO shot_e2e.staff (id, full_name, department) VALUES (gen_random_uuid(), 'Joy Akpan', 'Front desk');
-- Someone with no department: grouped on their own.
INSERT INTO shot_e2e.staff (id, full_name) VALUES (gen_random_uuid(), 'Uche Nwosu');
CREATE TEMP TABLE seed_joy AS SELECT id FROM shot_e2e.staff WHERE full_name = 'Joy Akpan';

-- The late rule, changed: 09:00.
UPDATE shot_e2e.setting SET value = '"09:00"' WHERE key = 'attendance.late_after_local';

-- Weekday shifts for fourteen people, 3 to 26 days ago. Times vary by person and day, so some
-- arrive after 09:00. Joy types some days, the screenshot account others, and the departure is
-- often typed by the other one.
CREATE TEMP TABLE seed_shift AS
SELECT gen_random_uuid() AS id, s.id AS staff_id, s.full_name, g.ago,
       ((t.d - g.ago)::timestamp AT TIME ZONE 'Africa/Lagos')
         + interval '07:40' + ((abs(hashtext(s.full_name || g.ago)) % 95) * interval '1 minute') AS clock_in_at,
       ((t.d - g.ago)::timestamp AT TIME ZONE 'Africa/Lagos')
         + interval '16:30' + ((abs(hashtext(g.ago || s.full_name)) % 90) * interval '1 minute') AS clock_out_at,
       CASE WHEN g.ago % 2 = 0 THEN (SELECT id FROM seed_actor) ELSE (SELECT id FROM seed_joy) END AS in_by,
       CASE WHEN g.ago % 3 = 0 THEN (SELECT id FROM seed_actor) ELSE (SELECT id FROM seed_joy) END AS out_by
  FROM seed_today t
  CROSS JOIN generate_series(3, 26) AS g(ago)
  JOIN shot_e2e.staff s ON s.full_name IN ('Divine Mike', 'Peter Obi', 'Amaka Obi', 'Faith Udo', 'Mariam Yusuf', 'Blessing Ike',
                                           'Daniel Johnson', 'Grace Nkem', 'Chidera Nnamdi', 'Tunde Bello', 'Emeka Nwankwo',
                                           'Halima Garba', 'Segun Alabi', 'Uche Nwosu')
 WHERE extract(isodow FROM t.d - g.ago) < 6;

-- Grace Nkem is on leave for four days (no shifts those days).
DELETE FROM seed_shift WHERE full_name = 'Grace Nkem' AND ago BETWEEN 8 AND 11;
INSERT INTO shot_e2e.leave (id, staff_id, starts_on, ends_on, kind_code, created_by)
SELECT gen_random_uuid(), s.id, t.d - 11, t.d - 8, 'ANNUAL', (SELECT id FROM seed_actor)
  FROM seed_today t JOIN shot_e2e.staff s ON s.full_name = 'Grace Nkem';
-- Musa Danjuma has sick leave and no record at all: "on leave", not "no record".
INSERT INTO shot_e2e.leave (id, staff_id, starts_on, ends_on, kind_code, created_by)
SELECT gen_random_uuid(), s.id, t.d - 6, t.d - 4, 'SICK', (SELECT id FROM seed_actor)
  FROM seed_today t JOIN shot_e2e.staff s ON s.full_name = 'Musa Danjuma';

-- Each person's shifts, numbered most recent first (rk 1 is their latest weekday shift), so the
-- cases below land on real shifts whatever the weekday is today.
CREATE TEMP TABLE seed_r AS
  SELECT seed_shift.*, row_number() OVER (PARTITION BY full_name ORDER BY ago) AS rk FROM seed_shift;

INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_out_at, clock_in_entered_by, clock_out_entered_by)
SELECT id, staff_id, clock_in_at, clock_out_at, in_by, out_by FROM seed_r;

-- NO SIGN-OUT: seven shifts closed with no time (hours unknown).
UPDATE shot_e2e.attendance_record r
   SET clock_out_at = NULL, clock_out_entered_by = NULL, signout_missing_at = r.clock_in_at + interval '12 hours', signout_missing_by = (SELECT id FROM seed_joy)
  FROM seed_r s
 WHERE r.id = s.id AND ((s.full_name = 'Tunde Bello' AND s.rk IN (2, 3, 8)) OR (s.full_name = 'Faith Udo' AND s.rk IN (5, 10))
                        OR (s.full_name = 'Emeka Nwankwo' AND s.rk = 13) OR (s.full_name = 'Uche Nwosu' AND s.rk = 4));

-- NEVER CLOSED: Halima Garba's second-latest shift is still open (her only open shift).
UPDATE shot_e2e.attendance_record r
   SET clock_out_at = NULL, clock_out_entered_by = NULL
  FROM seed_r s
 WHERE r.id = s.id AND s.full_name = 'Halima Garba' AND s.rk = 2;
-- ...and nothing after it for her (a person with an open shift cannot arrive again).
DELETE FROM shot_e2e.attendance_record r
 USING seed_r s
 WHERE r.id = s.id AND s.full_name = 'Halima Garba' AND s.rk = 1;

-- REMOVED: two records entered for the wrong person. They must count for NOTHING on the register.
UPDATE shot_e2e.attendance_record r
   SET voided_at = r.clock_in_at + interval '1 hour', corrected_at = r.clock_in_at + interval '1 hour',
       corrected_by = (SELECT id FROM seed_joy), correction_reason = 'SEED-REMOVED wrong person'
  FROM seed_r s
 WHERE r.id = s.id AND ((s.full_name = 'Segun Alabi' AND s.rk IN (6, 7)));

-- CORRECTED: three times changed, with who and why.
UPDATE shot_e2e.attendance_record r
   SET corrected_at = r.clock_in_at + interval '3 hours', corrected_by = (SELECT id FROM seed_actor),
       correction_reason = CASE s.full_name WHEN 'Peter Obi' THEN 'Book says 08:30' WHEN 'Mariam Yusuf' THEN 'Typed 18:15 for 17:15' ELSE 'Wrong time out' END
  FROM seed_r s
 WHERE r.id = s.id AND ((s.full_name = 'Peter Obi' AND s.rk = 6) OR (s.full_name = 'Mariam Yusuf' AND s.rk = 9) OR (s.full_name = 'Daniel Johnson' AND s.rk = 12));

-- RESTORED: removed by mistake and put back (the restore is a correction, in audit_log).
UPDATE shot_e2e.attendance_record r
   SET corrected_at = r.clock_in_at + interval '4 hours', corrected_by = (SELECT id FROM seed_joy), correction_reason = 'Removed by mistake'
  FROM seed_r s
 WHERE r.id = s.id AND s.full_name = 'Amaka Obi' AND s.rk = 10;
INSERT INTO shot_e2e.audit_log (at, actor_staff_id, entity, entity_id, action, before, after)
SELECT r.clock_in_at + interval '4 hours', (SELECT id FROM seed_joy), 'attendance_record', r.id::text, 'UPDATE',
       '{"voided": true}'::jsonb, '{"voided": false, "correction": "restore", "correction_reason": "Removed by mistake", "via": "correction"}'::jsonb
  FROM shot_e2e.attendance_record r JOIN seed_r s ON s.id = r.id
 WHERE s.full_name = 'Amaka Obi' AND s.rk = 10;

-- BACK-DATED: entered on a later day.
UPDATE shot_e2e.attendance_record r
   SET backdate_reason = 'Book found in the drawer'
  FROM seed_r s
 WHERE r.id = s.id AND s.full_name = 'Blessing Ike' AND s.rk IN (14, 15);

-- MOVEMENTS: ordinary ones, and two SELF-APPROVED (Peter Obi, the most senior, approved his own).
INSERT INTO shot_e2e.movement (id, attendance_record_id, left_at, returned_at, destination, purpose, approved_by, left_entered_by, returned_entered_by)
SELECT gen_random_uuid(), r.id, r.clock_in_at + interval '2 hours', r.clock_in_at + interval '3 hours',
       m.destination, m.purpose,
       CASE WHEN m.self THEN r.staff_id ELSE (SELECT id FROM shot_e2e.staff WHERE full_name = 'Peter Obi') END,
       (SELECT id FROM seed_actor), (SELECT id FROM seed_joy)
  FROM seed_r s
  JOIN shot_e2e.attendance_record r ON r.id = s.id
  JOIN (VALUES
    ('Peter Obi',    11, 'Zenith Bank',      'Signing',          true),
    ('Peter Obi',    12, 'Ministry of Lands', 'C of O follow-up', true),
    ('Divine Mike',  11, 'First Bank, Marina', 'Cheque lodgement', false),
    ('Mariam Yusuf', 12, 'Federal Land Registry', 'Document search', false)
  ) AS m(name, rk, destination, purpose, self) ON m.name = s.full_name AND m.rk = s.rk
 WHERE r.clock_out_at IS NOT NULL;
