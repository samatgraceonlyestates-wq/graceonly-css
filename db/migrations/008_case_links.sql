-- 008 case links: ties a CSS visit to a PORTAL case, so the same complaint is not
-- raised twice. INERT until the portal's case endpoints exist (none is built).
-- Kept in its own file so it can be dropped or changed without touching the rest.
--
-- CSS stores NO complaint text, status, age or resolution (rule 2: the portal
-- owns them). Only the link and the request that created it. Consequence: if
-- the portal call fails, what the desk typed lives only in the browser.
--
-- Both tables use composite foreign keys to visit (id, portal_client_id), whose
-- column is NULL on a non-client's visit. A non-client therefore cannot have a
-- case link or a case request: the database refuses it (rule 3).

BEGIN;

-- A case CSS knows about for a visit.
--  RAISED_HERE  this visit created it (through the portal's create endpoint).
--  DISCUSSED    an existing case that came up at this visit.
CREATE TABLE visit_case_link (
  id               uuid PRIMARY KEY,
  visit_id         uuid NOT NULL,
  portal_client_id uuid NOT NULL,
  portal_case_id   text NOT NULL
    CONSTRAINT visit_case_link_case_id_not_blank_check CHECK (btrim(portal_case_id) <> ''),
  kind             text NOT NULL
    CONSTRAINT visit_case_link_kind_valid_check CHECK (kind IN ('RAISED_HERE', 'DISCUSSED')),
  linked_by        uuid NOT NULL REFERENCES staff (id),
  linked_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_case_link_visit_is_client_fkey
    FOREIGN KEY (visit_id, portal_client_id) REFERENCES visit (id, portal_client_id),
  CONSTRAINT visit_case_link_visit_case_key UNIQUE (visit_id, portal_case_id)
);

CREATE INDEX visit_case_link_case_idx ON visit_case_link (portal_case_id);
CREATE INDEX visit_case_link_client_idx ON visit_case_link (portal_client_id);

-- An attempt to create a case. `id` IS the idempotency key: the application
-- generates it before calling the portal and sends it with the create request
-- (the portal must be asked to accept it; see CLAUDE.md). A retry after a
-- timeout reuses the same row and the same key.
--
--  PENDING    sent, outcome not known (including after a timeout). NOT a failure.
--  CONFIRMED  the portal answered with the case id.
--  FAILED     the portal definitely did not create it.
CREATE TABLE case_request (
  id                 uuid PRIMARY KEY,
  visit_id           uuid NOT NULL,
  portal_client_id   uuid NOT NULL,
  -- The portal's dispute type code (its vocabulary, not ours: no foreign key).
  -- REALTOR_CONDUCT is record-only on the portal and can never be read back by a
  -- CSS key, so CSS must never raise one.
  type_code          text NOT NULL,
  portal_purchase_id text,
  state              text NOT NULL DEFAULT 'PENDING'
    CONSTRAINT case_request_state_valid_check CHECK (state IN ('PENDING', 'CONFIRMED', 'FAILED')),
  portal_case_id     text,
  requested_by       uuid NOT NULL REFERENCES staff (id),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  settled_at         timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_request_visit_is_client_fkey
    FOREIGN KEY (visit_id, portal_client_id) REFERENCES visit (id, portal_client_id),
  CONSTRAINT case_request_type_code_format_check
    CHECK (type_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT case_request_not_realtor_conduct_check
    CHECK (type_code <> 'REALTOR_CONDUCT'),
  CONSTRAINT case_request_case_id_matches_confirmed_check
    CHECK ((state = 'CONFIRMED') = (portal_case_id IS NOT NULL)),
  CONSTRAINT case_request_settled_at_matches_pending_check
    CHECK ((state = 'PENDING') = (settled_at IS NULL))
);

-- The double-submit guard: one live request per visit, type and purchase.
CREATE UNIQUE INDEX case_request_live_key
  ON case_request (visit_id, type_code, coalesce(portal_purchase_id, ''))
  WHERE state IN ('PENDING', 'CONFIRMED');
CREATE INDEX case_request_pending_idx ON case_request (requested_at) WHERE state = 'PENDING';

CREATE TRIGGER case_request_touch_updated_at
  BEFORE UPDATE ON case_request
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

COMMIT;
