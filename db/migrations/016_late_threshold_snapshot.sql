-- 016 the late threshold belongs to the record.
--
-- WHY. "Late" is a clock-in after attendance.late_after_local (a Lagos wall-clock time,
-- "09:15"). Until now the register judged EVERY record, of any date, by whatever that setting
-- says NOW. The setting exists to be changed, so changing it would silently re-judge every
-- past period, and the register is the document someone is judged by. Nobody re-checks a
-- number on a report.
--
-- So each record carries a SNAPSHOT of the threshold that applied when it was entered, and
-- lateness is judged from the snapshot everywhere (the register, any total; the board does
-- not judge lateness). THE SAME PATTERN AS visit.client_name_logged (003: the name as logged
-- at the desk, never refreshed from the portal) and attendance_record.clock_in_device_kind
-- (009: the device kind at the time of entry, so relabelling a device never rewrites
-- history): a value that can change later is COPIED onto the row when the row is written,
-- because the row records what was true then. It is never refreshed.
--
-- WHAT A CORRECTION DOES TO IT: NOTHING. Correcting a time in, a time out, reopening,
-- unmarking, removing or restoring never moves the snapshot. The rule that applied on the day
-- still applied on the day; a correction fixes what was TYPED, not which rule was in force.
-- (If the snapshot followed the setting at correction time, correcting a typo in March under
-- a rule changed in April would quietly re-judge a March arrival: exactly the problem this
-- migration exists to stop.)
--
-- A BACK-DATED record (entered on a later day than the one it describes) takes the setting
-- at the time of ENTRY. Setting history is not kept, so the rule on the day itself cannot be
-- known; when the setting has not changed in between, they are the same.
--
-- NULL means no readable rule was in force when the record was entered (the setting missing
-- or not a time of day): lateness for that record is UNKNOWN, shown as unknown, never guessed.
--
-- EXISTING ROWS take the setting as it is now, the best available knowledge: nothing records
-- what it was before. (On the cPanel server no attendance row has been written, see 010.)
--
-- NOT DONE HERE, same class of problem: the DEPARTMENT. A record shows the person's CURRENT
-- department. Nothing can change a department yet, so it is hypothetical today; it needs the
-- same snapshot the moment department editing exists (see CLAUDE.md).
BEGIN;

ALTER TABLE attendance_record
  ADD COLUMN late_after_local text
    CONSTRAINT attendance_late_after_local_format_check
    CHECK (late_after_local IS NULL OR late_after_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- The setting's value is a JSON string ('"09:15"'); #>> '{}' takes its text. Anything that is
-- not a time of day leaves the row NULL (unknown) rather than failing or guessing.
UPDATE attendance_record
   SET late_after_local = (SELECT value #>> '{}' FROM setting WHERE key = 'attendance.late_after_local')
 WHERE (SELECT value #>> '{}' FROM setting WHERE key = 'attendance.late_after_local') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';

COMMIT;
