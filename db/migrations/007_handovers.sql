-- 007 document handovers: the physical record that Legal gave a visitor a
-- document (PRD 6.2, FR-3.1 to FR-3.5). Not used by any built screen yet.
--
-- THE GATE IS THE PORTAL'S. CSS has no override and no PIN (owner's decision,
-- see CLAUDE.md). `gate_answer` records what the portal's release-check told the
-- desk at the moment of handover. It is an audit fact, not a mirror of portal
-- data, and it is the only portal answer CSS stores.
--
--   CHECKED_ALLOWED  release-check answered, and allowed it.
--   CHECKED_BLOCKED  release-check answered, and refused it.
--   GATE_OFF         the gate was off (409 GATE_NOT_ACTIVE): "unknown, do not release".
--   UNAVAILABLE      the check could not be made (network, 429, 503).
--   NOT_GATED        the document is outside the gate (an unattached document).
--
-- The application offers "record a handover" ONLY on CHECKED_ALLOWED or
-- NOT_GATED. The other three values exist because a handover that happened
-- anyway is a fact the audit trail must not lose: refusing to record a release
-- does not undo it. A row carrying one of them is reportable.
--
-- Handover rows are append-only. A mistake is answered by a new row, not an edit.

BEGIN;

-- The portal's document vocabulary: the six slots, then OTHER (an unattached
-- document's seventh type). Labels are the portal's own (portal.ts
-- DOCUMENT_LABELS). The PRD's starter list used different names; the portal's
-- are authoritative. A new type is an INSERT.
CREATE TABLE document_type (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  label      text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO document_type (code, label, sort_order) VALUES
  ('DEED_OF_ASSIGNMENT',       'Deed of Assignment',        1),
  ('SURVEY_PLAN',              'Provisional Survey Plan',   2),
  ('RECEIPT',                  'Receipt of Payment',        3),
  ('CONTRACT_OF_SALE',         'Purchase Agreement',        4),
  ('ACKNOWLEDGMENT_LETTER',    'Initial Allocation Letter', 5),
  ('CERTIFICATE_OF_OCCUPANCY', 'C of O Copy',               6),
  ('OTHER',                    'Other',                     7);

CREATE TABLE handover (
  id                 uuid PRIMARY KEY,
  visit_id           uuid NOT NULL REFERENCES visit (id),
  released_by        uuid NOT NULL REFERENCES staff (id),
  released_at        timestamptz NOT NULL DEFAULT now(),
  -- The portal's purchase id the documents belong to, opaque. NULL when the
  -- handover is not tied to one purchase.
  portal_purchase_id text,
  gate_answer        text NOT NULL CHECK (gate_answer IN
    ('CHECKED_ALLOWED', 'CHECKED_BLOCKED', 'GATE_OFF', 'UNAVAILABLE', 'NOT_GATED')),
  -- The requestId of the portal call that gave the answer, so the portal's owner
  -- can find it. NULL only when no call was made or none returned one.
  gate_request_id    text,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX handover_visit_idx ON handover (visit_id);
CREATE INDEX handover_released_idx ON handover (released_at);

CREATE TABLE handover_item (
  handover_id        uuid NOT NULL REFERENCES handover (id),
  document_type_code text NOT NULL REFERENCES document_type (code),
  quantity           integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (handover_id, document_type_code)
);

CREATE TRIGGER handover_no_row_change
  BEFORE UPDATE OR DELETE ON handover
  FOR EACH ROW EXECUTE PROCEDURE forbid_change();
CREATE TRIGGER handover_no_truncate
  BEFORE TRUNCATE ON handover
  FOR EACH STATEMENT EXECUTE PROCEDURE forbid_change();

CREATE TRIGGER handover_item_no_row_change
  BEFORE UPDATE OR DELETE ON handover_item
  FOR EACH ROW EXECUTE PROCEDURE forbid_change();
CREATE TRIGGER handover_item_no_truncate
  BEFORE TRUNCATE ON handover_item
  FOR EACH STATEMENT EXECUTE PROCEDURE forbid_change();

COMMIT;
