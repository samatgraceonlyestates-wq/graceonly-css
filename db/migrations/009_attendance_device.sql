-- 009 attendance device: record WHERE a clock-in and a clock-out came from, and
-- add the switch that can later forbid clocking in from a personal device.
--
-- Context. There is no front-desk computer yet; staff log in from their own
-- phones, so a clock-in can happen from anywhere. That is NOT blocked, because
-- the hardware does not exist. It is RECORDED and made visible (screen 08 must
-- mark a clock-in made from a PERSONAL device), and the setting seeded below is
-- the switch for tightening it later. This file only ADDS to attendance_record
-- (ALTER TABLE ... ADD); it does not rewrite anything.
--
-- The device ids (clock_in_device_id, clock_out_device_id) already exist from 005.
-- This adds the KIND of each device, as a SNAPSHOT.
--
-- WHY A SNAPSHOT AND NOT A LIVE LOOKUP. device.kind can change: a device can be
-- relabelled from PERSONAL to DESK later (or the reverse). An attendance record
-- from before the change must keep saying what the device WAS when the person
-- clocked in, or the register would rewrite its own history and a PERSONAL
-- clock-in would quietly turn into a DESK one. This is the same reason
-- visit.client_name_logged exists: a log records what was true at the time, not
-- what the other table says now. The application writes the kind when it writes
-- the record; the database can only check that it is well formed, not that it
-- matches device.kind at that moment.
--
-- The kind columns are NULL on a row with no device, so there is nothing to
-- backfill on a new schema. No attendance row has ever been written (the
-- application does not exist yet). If rows with a device but no kind ever
-- existed, the constraints below would reject this migration rather than guess.

BEGIN;

ALTER TABLE attendance_record
  ADD COLUMN clock_in_device_kind text
    CONSTRAINT attendance_clock_in_device_kind_valid_check
    CHECK (clock_in_device_kind IN ('DESK', 'PERSONAL')),
  ADD COLUMN clock_out_device_kind text
    CONSTRAINT attendance_clock_out_device_kind_valid_check
    CHECK (clock_out_device_kind IN ('DESK', 'PERSONAL'));

-- A device and its kind travel together: both set or both null, never one.
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_clock_in_device_pair_check
    CHECK ((clock_in_device_id IS NULL) = (clock_in_device_kind IS NULL)),
  ADD CONSTRAINT attendance_clock_out_device_pair_check
    CHECK ((clock_out_device_id IS NULL) = (clock_out_device_kind IS NULL));

-- A clock-out device can only exist on a record that has been clocked out.
-- (The kind follows from the pair check above.) The reverse is allowed: a
-- clock-out time with no device is an admin-entered or corrected record.
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_clock_out_device_needs_clock_out_check
    CHECK (clock_out_device_id IS NULL OR clock_out_at IS NOT NULL);

-- A real clock-in always has a device; an admin-entered row never does. So a row
-- with NO clock-in device must be a manual entry, which 005 already forces to
-- carry a correction_reason (attendance_correction_reason_matches_entered_by_check
-- ties the reason to entered_by). This is what stops a missing device from
-- looking like a legitimate clock-in.
ALTER TABLE attendance_record
  ADD CONSTRAINT attendance_no_device_needs_correction_reason_check
    CHECK (clock_in_device_id IS NOT NULL OR correction_reason IS NOT NULL);

-- The tightening switch. false = clocking in from any device is allowed (and
-- recorded, with its kind). When the reception computer is bought and registered
-- as a DESK device, setting this row's value to true makes the application refuse
-- a clock-in from a PERSONAL device: an UPDATE of this one row, with no code
-- change and no migration. NOTHING READS IT YET; it exists so the switch is
-- already in place.
INSERT INTO setting (key, value) VALUES
  ('attendance.clock_in_requires_desk_device', 'false');

COMMIT;
