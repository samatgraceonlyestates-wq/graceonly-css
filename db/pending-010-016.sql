-- ============================================================================
-- db/pending-010-016.sql  --  GENERATED FILE.  THIS IS NOT A MIGRATION.
--
-- Migrations 010 to 016 from db/migrations/, verbatim and in filename order, as ONE
-- file for the cPanel server, which ALREADY HAS 001 to 009 (it took db/pg10-proof.sql
-- once, for those). Apply it ONCE, on top of 001-009. Never on an empty database
-- (use pg10-proof.sql there), never twice, and never together with the separate
-- migration files it contains. It is not the proof file and never goes in
-- db/migrations/.
--
-- Do not edit it.  Regenerate:  node db/build-pending.mjs   (npm run db:pending)
--                  Is it stale: node db/build-pending.mjs --check
--
-- Run it with psql (the \echo and \set lines are psql commands):
--   psql -X -v ON_ERROR_STOP=1 -f pending-010-016.sql <connection>
-- Each migration keeps its own BEGIN/COMMIT; there is no outer transaction. If one
-- fails it rolls back, but the ones before it stay applied: the last
-- '>>> applying' line printed names the file that failed, and everything before it
-- is in. Fix the cause and apply the REMAINING migration files one at a time; do not
-- run this whole file again.
--
-- psql reports  psql:pending-010-016.sql:LINE: ERROR: ...  Find LINE below. The line
-- inside the source file is  LINE - first + 1.  Lines are counted in THIS file.
--
--   010_roster_movements_backdating.sql lines    35 -   189
--   011_entered_by_per_event.sql     lines   191 -   241
--   012_movement_entered_by_names.sql lines   243 -   272
--   013_signout_missing.sql          lines   274 -   323
--   014_corrections.sql              lines   325 -   388
--   015_movement_corrections.sql     lines   390 -   449
--   016_late_threshold_snapshot.sql  lines   451 -   500
-- ============================================================================
\set ON_ERROR_STOP on
\echo '>>> applying 010_roster_movements_backdating.sql'
-- 010 roster people, the movement book, and back-dated attendance.
--
-- WHY. Attendance does not work the way 005 and 009 assumed. Staff do not clock
-- themselves in: they sign a paper book at reception and the front desk copies it
-- into CSS in a batch, clocking people out one at a time through the day. Only the
-- front desk (one or two people) and the owner ever sign in. The people whose
-- attendance is recorded have no login, never will, and must still be stored. A
-- second paper book, the movement book, records every time one of them leaves the
-- premises and comes back. Any earlier day can be entered or corrected. See
-- CLAUDE.md, "ATTENDANCE: HOW IT REALLY WORKS".
--
-- This is the first APPEND-ONLY migration: 001 to 009 are not touched. It runs on
-- a database that already holds 001 to 009 (the cPanel server) AND on a fresh one,
-- in order. Nothing has ever written an attendance row, which the NOT NULL in
-- section 2 relies on: it would fail loudly, not guess, if a row existed.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A person who never signs in must be storable in `staff`.
--
-- `staff` now holds two kinds of person. A LOGIN account has a password hash and an
-- email. A ROSTER person has neither (usually), may have no department yet (a
-- required department would block quick entry; screen 08 groups them under
-- "unassigned"), and is only ever the subject of attendance or the approver named
-- on a movement. Whether a row can sign in is decided by password_hash IS NOT NULL
-- and nothing else; the application refuses a NULL hash (authCore.ts).
--
-- NULLs and the checks already on the table:
--  * staff_email_format_check is  email = btrim(email) AND position('@' in email) > 1.
--    A CHECK passes when its expression is NULL (only FALSE fails), and with a NULL
--    email the whole expression is NULL, so a roster person passes. A NON-NULL email
--    is still fully checked, so '' or ' a@b' or 'ab' is still refused.
--  * staff_email_lower_key is a unique index on lower(email). A unique index treats
--    NULLs as distinct from each other, so any number of roster people can have no
--    email; two people with the SAME non-null email are still refused.
--  * staff_department_not_blank_check is  btrim(department) <> ''. NULL passes, but
--    an empty or all-space department is still refused: "none" is NULL, never ''.
ALTER TABLE staff
  ALTER COLUMN email         DROP NOT NULL,
  ALTER COLUMN department    DROP NOT NULL,
  ALTER COLUMN password_hash DROP NOT NULL;

-- You cannot sign in without an identifier: a password needs an email to go with it.
ALTER TABLE staff
  ADD CONSTRAINT staff_password_needs_email_check
    CHECK (password_hash IS NULL OR email IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. attendance_record: the front desk enters everything.
--
-- Two constraints from 005 and 009 assumed self-service and now forbid the normal
-- case, so they are dropped (not edited; 005 and 009 stay as they ran):
--   attendance_correction_reason_matches_entered_by_check
--     said: entered_by is set exactly when correction_reason is. But now EVERY
--     record has entered_by (the front desk typed it), and only a CORRECTION of an
--     existing record has a correction_reason.
--   attendance_no_device_needs_correction_reason_check
--     said: no clock-in device means a manual entry, which must carry a reason. But
--     there is no registered desk device yet (the table is empty), so every entry
--     has no device, and a reason on every row would be noise.
-- What still guards correction_reason: attendance_correction_reason_not_blank_check
-- (005), so a reason, when present, is never blank. That a correction CARRIES a
-- reason is an application rule (the database cannot tell an UPDATE from a first
-- write in a CHECK); the before and after of every correction go to audit_log.
ALTER TABLE attendance_record
  DROP CONSTRAINT attendance_correction_reason_matches_entered_by_check;
ALTER TABLE attendance_record
  DROP CONSTRAINT attendance_no_device_needs_correction_reason_check;

-- Every record says WHO ENTERED IT: screen 08 shows it, because one person typing
-- everyone else's attendance is the thing that must be visible. (The device columns
-- from 009 stay, now meaning "the machine the ENTRY was made on".)
ALTER TABLE attendance_record
  ALTER COLUMN entered_by SET NOT NULL;

-- A record CREATED for an earlier day is a different event from a correction of an
-- existing record, so it has its own reason, not blank when present.
--
-- NOT ENFORCED BY THE DATABASE: "a back-dated record must carry a reason". Back-dated
-- means the Lagos day of clock_in_at is before the day the row was written, and that
-- needs now(). now() is not immutable and cannot appear in a CHECK constraint.
-- (created_at is no help: it is itself now().) So the APPLICATION must set
-- backdate_reason whenever it creates a record for a Lagos day before today
-- (lagosDateOf, lagosTime.ts). The database only refuses a blank one. Do not assume
-- a record without a backdate_reason was written on the day it describes.
ALTER TABLE attendance_record
  ADD COLUMN backdate_reason text
    CONSTRAINT attendance_backdate_reason_not_blank_check
    CHECK (backdate_reason IS NULL OR btrim(backdate_reason) <> '');

-- ---------------------------------------------------------------------------
-- 3. movement: leaving the premises during the day, and coming back.
--
-- A movement belongs to an attendance_record, NOT to a person: it only makes sense
-- for someone recorded as in that day, and NOT NULL plus the foreign key make the
-- database refuse any other. An open movement (returned_at IS NULL) means the
-- person is out NOW.
CREATE TABLE movement (
  id                   uuid PRIMARY KEY,
  attendance_record_id uuid NOT NULL REFERENCES attendance_record (id),
  left_at              timestamptz NOT NULL DEFAULT now(),
  returned_at          timestamptz,
  destination          text NOT NULL
    CONSTRAINT movement_destination_not_blank_check CHECK (btrim(destination) <> ''),
  purpose              text NOT NULL
    CONSTRAINT movement_purpose_not_blank_check CHECK (btrim(purpose) <> ''),
  -- A staff row, so whoever approves a movement must exist in the roster. Whether the
  -- approver must be a manager, and may not be the person leaving, is an application
  -- rule: the approver's role is in staff_role, and "the person leaving" is reached
  -- through attendance_record, neither of which a CHECK can see.
  approved_by          uuid NOT NULL REFERENCES staff (id),
  -- The front-desk person who wrote it down (named entered_by, like attendance_record).
  entered_by           uuid NOT NULL REFERENCES staff (id),
  -- The machine the entry was made on, recorded as attendance_record does it (009):
  -- the id plus a SNAPSHOT of the kind, so relabelling a device later never rewrites
  -- history. Both set or both null.
  entered_device_id    uuid REFERENCES device (id),
  entered_device_kind  text
    CONSTRAINT movement_entered_device_kind_valid_check CHECK (entered_device_kind IN ('DESK', 'PERSONAL')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movement_returned_after_left_check
    CHECK (returned_at IS NULL OR returned_at >= left_at),
  CONSTRAINT movement_entered_device_pair_check
    CHECK ((entered_device_id IS NULL) = (entered_device_kind IS NULL))
);

-- NOT ENFORCED BY THE DATABASE: "a movement lies inside its shift", that is
--   left_at >= clock_in_at of its record, and, once the record is clocked out,
--   returned_at <= clock_out_at, and a record cannot be clocked out while one of its
--   movements is still open.
-- A CHECK can only see its own row, and these compare columns of two tables. A
-- trigger could, but it would have to fire on BOTH tables (a correction that moves
-- clock_in_at later would orphan a movement that was legal when written), it could
-- only raise an error with no message a front-desk person can act on, and this
-- schema keeps triggers for the append-only guards and touch_updated_at. So the
-- APPLICATION checks it, in the same transaction as the write and for BOTH writes
-- (recording a movement, and correcting or closing the shift), and
-- dbConstraints.ts has no entry for it because the database never reports it. Do not
-- assume a row here is inside its shift just because it was accepted.

-- One open movement per record: a person cannot be out twice at the same time. This
-- partial unique index is also THE index for the question asked all day, "who is out
-- right now?": it holds exactly the open movements and nothing else.
CREATE UNIQUE INDEX movement_one_open_key ON movement (attendance_record_id)
  WHERE returned_at IS NULL;
-- A person's movements for a day, in order (the record carries the day).
CREATE INDEX movement_record_idx ON movement (attendance_record_id, left_at);

CREATE TRIGGER movement_touch_updated_at
  BEFORE UPDATE ON movement
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

COMMIT;
\echo '>>> applying 011_entered_by_per_event.sql'
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
\echo '>>> applying 012_movement_entered_by_names.sql'
-- 012 one naming pattern for "who typed it": <event>_entered_by.
--
-- attendance_record already follows it (clock_in_entered_by, clock_out_entered_by,
-- from 010 and 011). movement did not: 010 named the author of the departure
-- entered_by, and 011 named the author of the return returned_recorded_by. Both
-- now say which EVENT they belong to, in the same shape.
--
--   movement.entered_by           ->  left_entered_by       (who typed the departure)
--   movement.returned_recorded_by ->  returned_entered_by   (who typed the return)
--
-- This is a new migration and not an edit to 010 or 011, even though the server has
-- neither yet: both are applied to the local database that holds the owner's login,
-- which cannot be rebuilt, and a migration file must describe a schema that exists.
--
-- As in 011, a column rename leaves its foreign key's and check's NAMES alone, and a
-- constraint name is part of the application's contract (dbConstraints.ts), so each
-- is renamed to match. Nothing else changes: no column, type, nullability or rule.
-- (movement.entered_device_id and entered_device_kind keep their names: they record
-- the machine the departure was entered on, as attendance_record's device columns do.)

BEGIN;

ALTER TABLE movement RENAME COLUMN entered_by TO left_entered_by;
ALTER TABLE movement RENAME CONSTRAINT movement_entered_by_fkey TO movement_left_entered_by_fkey;

ALTER TABLE movement RENAME COLUMN returned_recorded_by TO returned_entered_by;
ALTER TABLE movement RENAME CONSTRAINT movement_returned_recorded_by_fkey TO movement_returned_entered_by_fkey;
ALTER TABLE movement RENAME CONSTRAINT movement_returned_recorded_by_matches_check TO movement_returned_entered_by_matches_check;

COMMIT;
\echo '>>> applying 013_signout_missing.sql'
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
\echo '>>> applying 014_corrections.sql'
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
\echo '>>> applying 015_movement_corrections.sql'
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
\echo '>>> applying 016_late_threshold_snapshot.sql'
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
