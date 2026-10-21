-- 011 who typed each EVENT, not just each record.
--
-- WHY. 010 gave attendance_record one entered_by. But a record is two events, the
-- arrival and the departure, and with one or two front-desk people they are often
-- typed by different people (one copies the morning's arrivals from the paper book,
-- the other clocks people out through the day). "Who typed this" is the
-- accountability mechanism for the whole feature, so it must say which event. The
-- same is true of a movement: whoever records the return may not be whoever recorded
-- the departure.
--
-- Nothing outside this repository reads these columns and the server holds no
-- attendance data, so the rename is safe and no data needs carrying across.
--
-- Append-only: 001 to 010 are not touched. The server receives 010 and 011 together.

BEGIN;

-- 1. The arrival. entered_by now means "who typed the ARRIVAL", and the honest name
--    prevents permanent confusion. A column rename keeps its NOT NULL (from 010) and
--    its foreign key, but PostgreSQL does not rename the foreign key's NAME, and a
--    constraint name is part of the application's contract (dbConstraints.ts), so it
--    is renamed to match.
ALTER TABLE attendance_record
  RENAME COLUMN entered_by TO clock_in_entered_by;
ALTER TABLE attendance_record
  RENAME CONSTRAINT attendance_record_entered_by_fkey TO attendance_clock_in_entered_by_fkey;

-- 2. The departure: who typed the clock-out. Present exactly when the clock-out time
--    is: a departure with nobody to answer for it cannot be stored, and neither can a
--    name against a departure that has not happened.
ALTER TABLE attendance_record
  ADD COLUMN clock_out_entered_by uuid;
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_clock_out_entered_by_fkey
    FOREIGN KEY (clock_out_entered_by) REFERENCES staff (id);
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_clock_out_entered_by_matches_check
    CHECK ((clock_out_at IS NULL) = (clock_out_entered_by IS NULL));

-- 3. A movement's return: who typed it, present exactly when returned_at is. (The
--    departure's author is movement.entered_by, from 010.)
ALTER TABLE movement
  ADD COLUMN returned_recorded_by uuid;
ALTER TABLE movement
  ADD CONSTRAINT movement_returned_recorded_by_fkey
    FOREIGN KEY (returned_recorded_by) REFERENCES staff (id);
ALTER TABLE movement
  ADD CONSTRAINT movement_returned_recorded_by_matches_check
    CHECK ((returned_at IS NULL) = (returned_recorded_by IS NULL));

COMMIT;
