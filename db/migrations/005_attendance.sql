-- 005 staff attendance and leave, plus the settings they read.
--
-- Not in the PRD; this is screens 07 and 08. Present / late / absent / on leave,
-- shift durations and the week and month totals are DERIVED from these rows and
-- are never stored.
--
-- What attendance proves: that the person AUTHENTICATED at a registered device
-- (or from the office network). It cannot prove physical presence (a PIN can be
-- shoulder-surfed). The device and IP are recorded so the register can show them
-- and so two clock-ins from one device in quick succession can be flagged.

BEGIN;

CREATE TABLE attendance_record (
  id                   uuid PRIMARY KEY,
  staff_id             uuid NOT NULL REFERENCES staff (id),
  clock_in_at          timestamptz NOT NULL DEFAULT now(),
  clock_out_at         timestamptz,
  clock_in_device_id   uuid REFERENCES device (id),
  clock_out_device_id  uuid REFERENCES device (id),
  clock_in_ip          inet,
  clock_out_ip         inet,
  -- Set only when an admin entered or corrected the times for someone else. A
  -- correction must say why; the before/after goes to audit_log.
  entered_by           uuid REFERENCES staff (id),
  correction_reason    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_clock_out_after_in_check
    CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at),
  CONSTRAINT attendance_correction_reason_matches_entered_by_check
    CHECK ((entered_by IS NULL) = (correction_reason IS NULL)),
  CONSTRAINT attendance_correction_reason_not_blank_check
    CHECK (correction_reason IS NULL OR btrim(correction_reason) <> '')
);

-- One open shift per person. "At most one record per Lagos day" is an
-- application rule (checked in a transaction), not a constraint.
CREATE UNIQUE INDEX attendance_one_open_shift_key ON attendance_record (staff_id)
  WHERE clock_out_at IS NULL;
CREATE INDEX attendance_staff_idx ON attendance_record (staff_id, clock_in_at);
-- The register for a day: a range scan on clock_in_at between Lagos midnights.
CREATE INDEX attendance_clock_in_idx ON attendance_record (clock_in_at);

CREATE TRIGGER attendance_touch_updated_at
  BEFORE UPDATE ON attendance_record
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

-- Leave: dates and a kind, nothing more. Screen 08's ON LEAVE reads this.
-- Calendar days in Lagos, so `date`, not timestamptz. Overlapping leave for one
-- person is checked by the application (an exclusion constraint would need the
-- btree_gist extension, which these files avoid).
CREATE TABLE leave (
  id          uuid PRIMARY KEY,
  staff_id    uuid NOT NULL REFERENCES staff (id),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  kind_code   text NOT NULL REFERENCES leave_kind (code),
  approved_by uuid REFERENCES staff (id),
  note        text,
  created_by  uuid NOT NULL REFERENCES staff (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_ends_on_or_after_starts_check CHECK (ends_on >= starts_on)
);

CREATE INDEX leave_staff_idx ON leave (staff_id, starts_on);
CREATE INDEX leave_range_idx ON leave (starts_on, ends_on);

CREATE TRIGGER leave_touch_updated_at
  BEFORE UPDATE ON leave
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

-- Small configuration the application reads. Dropdown lists are NOT here: they
-- are lookup tables with foreign keys.
CREATE TABLE setting (
  key        text PRIMARY KEY CONSTRAINT setting_key_format_check CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES staff (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER setting_touch_updated_at
  BEFORE UPDATE ON setting
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

INSERT INTO setting (key, value) VALUES
  -- Office-local wall-clock time after which a clock-in is late. The design's
  -- rule is 09:15. Compared in Africa/Lagos.
  ('late_after_local', '"09:15"'),
  -- PLACEHOLDERS (07's targets: 40h a week, 160h a month), in minutes.
  ('weekly_target_minutes',  '2400'),
  ('monthly_target_minutes', '9600'),
  -- Office network egress addresses. Empty = no IP check yet.
  ('office_ip_allowlist', '[]');

COMMIT;
