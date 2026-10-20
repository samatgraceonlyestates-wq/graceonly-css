-- 006 audit log: every create / update / delete, with who and before / after.
--
-- Append-only (trigger here; the application's database role must also have no
-- UPDATE, DELETE or TRUNCATE grant). The PRD's 3-year retention means a purge,
-- and an append-only table needs a deliberate privileged path for it. That path
-- is not built here; decide it before the first purge is due.
--
-- before / after carry fields from an ALLOW-LIST kept in the application. Never
-- put portal client data in them (no email, balances, fee status, case text).

BEGIN;

CREATE TABLE audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  -- NULL = the system itself (for example an auto-close).
  actor_staff_id uuid REFERENCES staff (id),
  entity         text NOT NULL CHECK (btrim(entity) <> ''),
  entity_id      text NOT NULL,
  action         text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  before         jsonb,
  after          jsonb,
  CHECK (action = 'CREATE' OR before IS NOT NULL),
  CHECK (action = 'DELETE' OR after IS NOT NULL)
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, at);
CREATE INDEX audit_log_at_idx ON audit_log (at);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_staff_id, at);

CREATE TRIGGER audit_log_no_row_change
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE PROCEDURE forbid_change();
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE PROCEDURE forbid_change();

COMMIT;
