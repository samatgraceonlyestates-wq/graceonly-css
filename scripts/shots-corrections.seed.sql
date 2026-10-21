-- Extra records for scripts/shots-corrections.ts. LOCAL ONLY, THROWAWAY schema shot_e2e.
-- Run AFTER scripts/shots-arrivals.seed.sql and scripts/shots-board.seed.sql:
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f scripts/shots-corrections.seed.sql
-- (See scripts/shots-arrivals.seed.sql for creating the schema.) AT TIME ZONE appears
-- only because this is a test seed.

CREATE TEMP TABLE seed_day AS
  SELECT ((now() AT TIME ZONE 'Africa/Lagos')::date::timestamp AT TIME ZONE 'Africa/Lagos') AS start;

-- Zainab Musa: a CLOSED record yesterday, and an OPEN one today. Reopening yesterday's
-- must be refused (one open shift at a time).
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_out_at, clock_in_entered_by, clock_out_entered_by)
SELECT gen_random_uuid(), s.id, d.start - interval '1 day' + interval '08:00', d.start - interval '1 day' + interval '17:00', a.id, a.id
  FROM seed_day d
  CROSS JOIN (SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost') a
  JOIN shot_e2e.staff s ON s.full_name = 'Zainab Musa';

-- Kelechi Ibe: a finished day yesterday (to correct a time out on an earlier day).
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_out_at, clock_in_entered_by, clock_out_entered_by)
SELECT gen_random_uuid(), s.id, d.start - interval '1 day' + interval '08:20', d.start - interval '1 day' + interval '16:45', a.id, a.id
  FROM seed_day d
  CROSS JOIN (SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost') a
  JOIN shot_e2e.staff s ON s.full_name = 'Kelechi Ibe';

-- Today: Zainab and Funke are IN; Halima was clocked out (to be reopened).
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_out_at, clock_in_entered_by, clock_out_entered_by)
SELECT gen_random_uuid(), s.id, d.start + t.in_at, d.start + t.out_at, a.id, CASE WHEN t.out_at IS NULL THEN NULL ELSE a.id END
  FROM seed_day d
  CROSS JOIN (SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost') a
  JOIN (VALUES
    ('Zainab Musa',   interval '00:11', NULL::interval),
    ('Funke Adebisi', interval '00:12', NULL),
    ('Halima Garba',  interval '00:13', interval '00:20')
  ) AS t(name, in_at, out_at) ON true
  JOIN shot_e2e.staff s ON s.full_name = t.name;
