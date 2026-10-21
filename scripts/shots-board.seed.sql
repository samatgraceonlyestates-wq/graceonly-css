-- Today's records for scripts/shots-board.ts. LOCAL ONLY, THROWAWAY schema shot_e2e.
-- Run AFTER scripts/shots-arrivals.seed.sql (the account and the roster), as
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f scripts/shots-board.seed.sql
-- Times are small offsets after Lagos midnight, so they are always today and always in
-- the past (unless the run is in the first minutes after midnight in Lagos).
-- AT TIME ZONE appears here only because this is a test seed; application queries never
-- use it (CLAUDE.md: lagosTime.ts is the one place that converts Lagos days).

CREATE TEMP TABLE seed_day AS
  SELECT ((now() AT TIME ZONE 'Africa/Lagos')::date::timestamp AT TIME ZONE 'Africa/Lagos') AS start;

INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_out_at, clock_in_entered_by, clock_out_entered_by, signout_missing_at, signout_missing_by)
SELECT gen_random_uuid(), s.id, d.start + t.in_at, d.start + t.out_at,
       a.id,
       CASE WHEN t.out_at IS NULL THEN NULL ELSE a.id END,
       CASE WHEN t.unsigned THEN now() END,
       CASE WHEN t.unsigned THEN a.id END
  FROM seed_day d
  CROSS JOIN (SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost') a
  JOIN (VALUES
    -- name,             in,                   out,                  never signed out
    ('Divine Mike',      interval '00:05',     NULL::interval,       false),
    ('Peter Obi',        interval '00:06',     NULL,                 false),
    ('Amaka Obi',        interval '00:07',     NULL,                 false),
    ('Faith Udo',        interval '00:08',     NULL,                 false),
    ('Mariam Yusuf',     interval '00:09',     NULL,                 false),
    ('Blessing Ike',     interval '00:10',     NULL,                 false),
    ('Daniel Johnson',   interval '00:03',     interval '00:15',     false),
    ('Grace Nkem',       interval '00:04',     interval '00:16',     false),
    ('Chidera Nnamdi',   interval '00:02',     NULL,                 true),
    ('Tunde Bello',      interval '00:01',     NULL,                 false)
  ) AS t(name, in_at, out_at, unsigned) ON true
  JOIN shot_e2e.staff s ON s.full_name = t.name;

-- Tunde Bello is out on an open movement, approved by Peter Obi (a roster person).
INSERT INTO shot_e2e.movement (id, attendance_record_id, left_at, destination, purpose, approved_by, left_entered_by)
SELECT gen_random_uuid(), r.id, d.start + interval '00:12', 'First Bank, Marina', 'Cheque lodgement',
       (SELECT id FROM shot_e2e.staff WHERE full_name = 'Peter Obi'),
       (SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost')
  FROM seed_day d
  JOIN shot_e2e.attendance_record r ON r.staff_id = (SELECT id FROM shot_e2e.staff WHERE full_name = 'Tunde Bello');

-- Ngozi Adeyemi arrived two days ago and was never clocked out: an OPEN shift from an earlier day.
INSERT INTO shot_e2e.attendance_record (id, staff_id, clock_in_at, clock_in_entered_by)
SELECT gen_random_uuid(), s.id, d.start - interval '2 days' + interval '08:00', a.id
  FROM seed_day d
  CROSS JOIN (SELECT id FROM shot_e2e.staff WHERE email = 'screenshots@css.localhost') a
  JOIN shot_e2e.staff s ON s.full_name = 'Ngozi Adeyemi';
