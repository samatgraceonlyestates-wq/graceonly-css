-- 014 corrections: who changed a record, when, and removing a record entered for the
-- wrong person.
--
-- WHY. The front desk will type 09:30 where the book says 08:30. A mistake that cannot
-- be fixed makes her keep a second paper list, and then this system is decoration. A
-- record can now be CORRECTED (a time changed, a clock-out undone, a never-signed-out
-- mark undone) or REMOVED (entered for the wrong person), always with a reason.
--
-- The FULL history of every correction (before and after) is in audit_log. These
-- columns exist only so that a list can show AT A GLANCE that a record was changed,
-- by whom, when and why, without going to the audit log. They always describe the
-- LATEST correction; earlier ones are in audit_log.
--
-- correction_reason already exists (005); it was always meant for changing an existing
-- record. It now travels with the other two: all three present or none.
--
-- REMOVED IS A VOID, NOT A DELETE. A removed record keeps its row and gets voided_at.
--  * A deleted row cannot be audited: audit_log refers to it by id, and the id would
--    point at nothing. A voided row stays, with its reason and who removed it.
--  * Other rows point at a record (movement.attendance_record_id); a delete would have
--    to cascade or fail.
--  * Staff, and everything that points at them, are never deleted in this system.
-- A voided row would clutter every list, so EVERYTHING that lists or counts records
-- leaves it out (the board, "one record per person per day", the open-shift index
-- below), and it appears only in a "Removed records" list. The application must apply
-- the same rule in any query of its own: a record with voided_at set does not exist for
-- today's board, for hours, or for the one-record-a-day check.

BEGIN;

ALTER TABLE attendance_record
  ADD COLUMN corrected_at timestamptz,
  ADD COLUMN corrected_by uuid,
  ADD COLUMN voided_at timestamptz;

ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_corrected_by_fkey
    FOREIGN KEY (corrected_by) REFERENCES staff (id);

-- When and by whom come together: a correction always says who made it.
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_corrected_pair_check
    CHECK ((corrected_at IS NULL) = (corrected_by IS NULL));

-- And with the reason: a reason without them, or them without a reason, is refused.
-- (005's attendance_correction_reason_not_blank_check still refuses a blank reason.)
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_corrected_matches_reason_check
    CHECK ((correction_reason IS NULL) = (corrected_at IS NULL));

-- A removal is a correction: it carries the reason, the person and the time.
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_voided_needs_correction_check
    CHECK (voided_at IS NULL OR corrected_at IS NOT NULL);

-- One OPEN shift per person, as before, and a record that was never signed out is
-- closed (013). A REMOVED record is not a shift at all, so it must not block that
-- person (it is usually the wrong person's, and the right one is about to be entered).
-- Rebuilt under the same name.
DROP INDEX attendance_one_open_shift_key;
CREATE UNIQUE INDEX attendance_one_open_shift_key ON attendance_record (staff_id)
  WHERE clock_out_at IS NULL AND signout_missing_at IS NULL AND voided_at IS NULL;

COMMIT;
