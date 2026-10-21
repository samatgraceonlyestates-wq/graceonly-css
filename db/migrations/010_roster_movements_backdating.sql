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
