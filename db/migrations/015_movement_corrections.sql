-- 015 movements can be wrong too: corrections and removal.
--
-- The lesson from attendance (014) was that no way to correct is a blocker: she will
-- type 11:40 where the book says 10:40, or the wrong destination, or the wrong approver,
-- and a mistake that cannot be fixed makes her keep a second paper list. So movements get
-- the same columns attendance_record has, BEFORE the screens exist rather than after.
--
-- The FULL history of every correction (before and after) is in audit_log. These columns
-- are only so a list can show AT A GLANCE that a movement was changed, by whom, when and
-- why, and they always describe the LATEST correction. correction_reason, corrected_at
-- and corrected_by come together or not at all, exactly as on attendance_record.
--
-- REMOVED IS A VOID, NOT A DELETE (same reasoning as 014): the row stays, with its reason
-- and who removed it, so audit_log still points at something. A voided movement COUNTS
-- FOR NOTHING: it is not "out right now", it is in no total, and it does not stop the
-- same person leaving again. The index below excludes it; the application must exclude it
-- from every query of its own (a movement with voided_at set does not exist for the
-- board, for "who is out", for movements-inside-the-shift checks, or for any count).

BEGIN;

ALTER TABLE movement
  ADD COLUMN correction_reason text,
  ADD COLUMN corrected_at timestamptz,
  ADD COLUMN corrected_by uuid,
  ADD COLUMN voided_at timestamptz;

ALTER TABLE movement
  ADD CONSTRAINT movement_corrected_by_fkey
    FOREIGN KEY (corrected_by) REFERENCES staff (id);

-- A reason, when present, is never blank (as attendance_correction_reason_not_blank_check).
ALTER TABLE movement
  ADD CONSTRAINT movement_correction_reason_not_blank_check
    CHECK (correction_reason IS NULL OR btrim(correction_reason) <> '');

-- When and by whom come together: a correction always says who made it.
ALTER TABLE movement
  ADD CONSTRAINT movement_corrected_pair_check
    CHECK ((corrected_at IS NULL) = (corrected_by IS NULL));

-- And with the reason: a reason without them, or them without a reason, is refused.
ALTER TABLE movement
  ADD CONSTRAINT movement_corrected_matches_reason_check
    CHECK ((correction_reason IS NULL) = (corrected_at IS NULL));

-- A removal is a correction: it carries the reason, the person and the time.
ALTER TABLE movement
  ADD CONSTRAINT movement_voided_needs_correction_check
    CHECK (voided_at IS NULL OR corrected_at IS NOT NULL);

-- One OPEN movement per record, as before (a person cannot be out twice at once). A
-- REMOVED movement is not a movement at all, so it must not keep the person "out": the
-- index is rebuilt under the same name to exclude it. It is still THE index for the
-- question asked all day, "who is out right now?".
DROP INDEX movement_one_open_key;
CREATE UNIQUE INDEX movement_one_open_key ON movement (attendance_record_id)
  WHERE returned_at IS NULL AND voided_at IS NULL;

COMMIT;
