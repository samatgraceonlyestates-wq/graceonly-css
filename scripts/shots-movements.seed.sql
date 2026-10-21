-- Extra records for scripts/shots-movements.ts. LOCAL ONLY, THROWAWAY schema shot_e2e.
-- Run AFTER scripts/shots-arrivals.seed.sql and scripts/shots-board.seed.sql (it needs their
-- people and today's records):
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f scripts/shots-movements.seed.sql
-- (See scripts/shots-arrivals.seed.sql for creating the schema.) Times are small offsets
-- after Lagos midnight, so they are always today and always in the past. AT TIME ZONE
-- appears only because this is a test seed.

CREATE TEMP TABLE seed_day AS
  SELECT ((now() AT TIME ZONE 'Africa/Lagos')::date::timestamp AT TIME ZONE 'Africa/Lagos') AS start;
CREATE TEMP TABLE seed_actor AS SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost';
CREATE TEMP TABLE seed_peter AS SELECT id FROM shot_e2e.staff WHERE full_name = 'Peter Obi';

-- Movements already used (for the suggestions): GraceWaters twice, Bank once, the Registry once.
INSERT INTO shot_e2e.movement (id, attendance_record_id, left_at, returned_at, destination, purpose, approved_by, left_entered_by, returned_entered_by)
SELECT gen_random_uuid(), r.id, d.start + t.left_at, d.start + t.back_at, t.destination, t.purpose, (SELECT id FROM seed_peter), (SELECT id FROM seed_actor), (SELECT id FROM seed_actor)
  FROM seed_day d
  JOIN (VALUES
    ('Daniel Johnson', interval '00:05', interval '00:07', 'Bank',                  'Lodgement'),
    ('Daniel Johnson', interval '00:08', interval '00:12', 'GraceWaters Site',      'Site inspection'),
    ('Grace Nkem',     interval '00:06', interval '00:10', 'GraceWaters Site',      'Site inspection'),
    ('Mariam Yusuf',   interval '00:11', interval '00:13', 'Federal Land Registry', 'Document search')
  ) AS t(name, left_at, back_at, destination, purpose) ON true
  JOIN shot_e2e.staff s ON s.full_name = t.name
  JOIN shot_e2e.attendance_record r ON r.staff_id = s.id AND r.clock_in_at >= d.start;

-- Blessing Ike has a REMOVED movement (never left), to be restored.
INSERT INTO shot_e2e.movement (id, attendance_record_id, left_at, destination, purpose, approved_by, left_entered_by, voided_at, corrected_at, corrected_by, correction_reason)
SELECT gen_random_uuid(), r.id, d.start + interval '00:11', 'Court', 'Hearing', (SELECT id FROM seed_peter), (SELECT id FROM seed_actor),
       now(), now(), (SELECT id FROM seed_actor), 'Entered twice'
  FROM seed_day d
  JOIN shot_e2e.staff s ON s.full_name = 'Blessing Ike'
  JOIN shot_e2e.attendance_record r ON r.staff_id = s.id AND r.clock_in_at >= d.start;

-- Zainab Musa: an OPEN record today, and a REMOVED open record from yesterday. Restoring
-- yesterday's must be blocked (one open shift at a time).
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_in_entered_by)
SELECT gen_random_uuid(), s.id, d.start + interval '00:11', (SELECT id FROM seed_actor)
  FROM seed_day d JOIN shot_e2e.staff s ON s.full_name = 'Zainab Musa';
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_in_entered_by, voided_at, corrected_at, corrected_by, correction_reason)
SELECT gen_random_uuid(), s.id, d.start - interval '1 day' + interval '08:00', (SELECT id FROM seed_actor),
       now(), now(), (SELECT id FROM seed_actor), 'Wrong person'
  FROM seed_day d JOIN shot_e2e.staff s ON s.full_name = 'Zainab Musa';

-- Kelechi Ibe: a REMOVED closed record today AND a live closed record today. Restoring the
-- removed one is blocked (one record a day).
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_out_at, clock_in_entered_by, clock_out_entered_by)
SELECT gen_random_uuid(), s.id, d.start + interval '00:03', d.start + interval '00:04', (SELECT id FROM seed_actor), (SELECT id FROM seed_actor)
  FROM seed_day d JOIN shot_e2e.staff s ON s.full_name = 'Kelechi Ibe';
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_out_at, clock_in_entered_by, clock_out_entered_by, voided_at, corrected_at, corrected_by, correction_reason)
SELECT gen_random_uuid(), s.id, d.start + interval '00:01', d.start + interval '00:02', (SELECT id FROM seed_actor), (SELECT id FROM seed_actor),
       now(), now(), (SELECT id FROM seed_actor), 'Duplicate'
  FROM seed_day d JOIN shot_e2e.staff s ON s.full_name = 'Kelechi Ibe';

-- Funke Adebisi: a REMOVED open record today, with nothing in the way: a restore that works.
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_in_entered_by, voided_at, corrected_at, corrected_by, correction_reason)
SELECT gen_random_uuid(), s.id, d.start + interval '00:12', (SELECT id FROM seed_actor),
       now(), now(), (SELECT id FROM seed_actor), 'Wrong person'
  FROM seed_day d JOIN shot_e2e.staff s ON s.full_name = 'Funke Adebisi';
