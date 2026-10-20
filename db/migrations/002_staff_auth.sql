-- 002 staff and authentication: staff, their roles, registered desk devices and
-- sessions.
--
-- Everyone has individual credentials. A shared front-desk machine is a
-- registered `device`; on it a staff member may switch in with a PIN. Every
-- write carries a person (the session's staff_id), never "the desk".
--
-- Password and PIN hashes use scrypt from node:crypto (no dependency). Session
-- and device tokens are stored only as a SHA-256 hash; the raw token is never
-- stored. No staff phone, address or salary: not needed.

BEGIN;

CREATE TABLE staff (
  id                    uuid PRIMARY KEY,
  email                 text NOT NULL
    CONSTRAINT staff_email_format_check CHECK (email = btrim(email) AND position('@' in email) > 1),
  full_name             text NOT NULL
    CONSTRAINT staff_full_name_not_blank_check CHECK (btrim(full_name) <> ''),
  -- Free text for now: screen 08's filter chips are derived from the data, in
  -- order of first appearance.
  department            text NOT NULL
    CONSTRAINT staff_department_not_blank_check CHECK (btrim(department) <> ''),
  password_hash         text NOT NULL,
  must_change_password  boolean NOT NULL DEFAULT false,
  password_failed_count integer NOT NULL DEFAULT 0
    CONSTRAINT staff_password_failed_count_nonneg_check CHECK (password_failed_count >= 0),
  password_locked_until timestamptz,
  -- The PIN is only accepted on a registered desk device (an application rule).
  pin_hash              text,
  pin_failed_count      integer NOT NULL DEFAULT 0
    CONSTRAINT staff_pin_failed_count_nonneg_check CHECK (pin_failed_count >= 0),
  pin_locked_until      timestamptz,
  -- Staff are never deleted: visits and attendance point at them forever.
  is_active             boolean NOT NULL DEFAULT true,
  deactivated_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_active_matches_deactivated_check CHECK (is_active = (deactivated_at IS NULL))
);

CREATE UNIQUE INDEX staff_email_lower_key ON staff (lower(email));

CREATE TRIGGER staff_touch_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

-- One person, any number of roles (no "primary" role). What each role may do is
-- decided in the application.
CREATE TABLE staff_role (
  staff_id   uuid NOT NULL REFERENCES staff (id),
  role_code  text NOT NULL REFERENCES role (code),
  granted_by uuid REFERENCES staff (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, role_code)
);

-- A registered machine. DESK = the shared front-desk computer (PIN switching
-- and clock-in allowed). PERSONAL = someone's own machine.
CREATE TABLE device (
  id            uuid PRIMARY KEY,
  label         text NOT NULL
    CONSTRAINT device_label_not_blank_check CHECK (btrim(label) <> ''),
  kind          text NOT NULL
    CONSTRAINT device_kind_valid_check CHECK (kind IN ('DESK', 'PERSONAL')),
  token_hash    text NOT NULL CONSTRAINT device_token_hash_key UNIQUE,
  registered_by uuid NOT NULL REFERENCES staff (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

CREATE TABLE session (
  id           uuid PRIMARY KEY,
  staff_id     uuid NOT NULL REFERENCES staff (id),
  device_id    uuid REFERENCES device (id),
  token_hash   text NOT NULL CONSTRAINT session_token_hash_key UNIQUE,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  CONSTRAINT session_expires_after_created_check CHECK (expires_at > created_at)
);

CREATE INDEX session_staff_idx ON session (staff_id);
-- Sessions that can still be used; expiry is checked against now() in the query.
CREATE INDEX session_live_idx ON session (expires_at) WHERE revoked_at IS NULL;

COMMIT;
