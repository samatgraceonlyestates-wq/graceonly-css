-- 013 a shift that was never signed out.
--
-- WHY. The paper book will have people who went home without signing out. Until now
-- a record had two states: OPEN (no clock-out: still here) and CLOSED (a clock-out
-- time). A person may have only one open shift, so a forgotten sign-out could never
-- be put right: it stayed open for ever and blocked that person's next arrival.
--
-- A record now has THREE states:
--   still here               clock_out_at IS NULL     signout_missing_at IS NULL
--   left at a time           clock_out_at IS NOT NULL signout_missing_at IS NULL
--   NEVER SIGNED OUT         clock_out_at IS NULL     signout_missing_at IS NOT NULL
-- The third is CLOSED but has no time. It is a fact about the BOOK ("no sign-out was
-- written"), not about the person ("left"), and it is what the front desk marks, as
-- an explicit act, at the end of the day. It records WHEN it was marked and BY WHOM.
--
-- THE HOURS OF SUCH A SHIFT ARE UNKNOWN. They must never be treated as zero hours,
-- and never guessed: not to the end of the day, not to a usual finishing time, not to
-- the last movement. A total, a week or a timesheet that includes one must say it
-- includes a shift with unknown hours, or leave it out and say so. There is no column
-- for an estimate, on purpose.

BEGIN;

ALTER TABLE attendance_record
  ADD COLUMN signout_missing_at timestamptz,
  ADD COLUMN signout_missing_by uuid;

-- Both set or both null: a marking always says who made it.
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_signout_missing_by_fkey
    FOREIGN KEY (signout_missing_by) REFERENCES staff (id);
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_signout_missing_pair_check
    CHECK ((signout_missing_at IS NULL) = (signout_missing_by IS NULL));

-- "Never signed out" and "left at a time" are different answers to the same
-- question, so a record cannot be both.
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_signout_missing_no_clock_out_check
    CHECK (signout_missing_at IS NULL OR clock_out_at IS NULL);

-- One OPEN shift per person, as before. A record that was never signed out is
-- closed, so it is excluded: it must not stop that person arriving the next day.
-- The index is rebuilt under the same name (an index, not a constraint, so there is
-- no DROP/ADD CONSTRAINT of one name here).
DROP INDEX attendance_one_open_shift_key;
CREATE UNIQUE INDEX attendance_one_open_shift_key ON attendance_record (staff_id)
  WHERE clock_out_at IS NULL AND signout_missing_at IS NULL;

COMMIT;
