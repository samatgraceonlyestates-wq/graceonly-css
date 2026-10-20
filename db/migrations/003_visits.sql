-- 003 visits: non-client visitors, the visit itself, and its timeline.
--
-- There is NO client table. A client is a portal record; CSS keeps only the
-- portal client id and the name AS LOGGED at the desk (see visit). Everything
-- else about a client is read from the portal on demand and never stored.
--
-- Elapsed time, on track / long / overdue, and total duration are derived in the
-- application from checked_in_at / checked_out_at. They are never stored.

BEGIN;

-- Non-clients only (a Realtor, Investor, Delivery, Visitor, or a Client the
-- portal could not find). Repeat visits are identified by a desk-CONFIRMED match
-- on this table, never an automatic merge.
CREATE TABLE visitor (
  id                      uuid PRIMARY KEY,
  display_name            text NOT NULL CHECK (btrim(display_name) <> ''),
  organisation            text,
  -- Typed by the desk and normalised to E.164. Optional: a courier may give none.
  phone                   text CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  -- NDPR: consent is captured when the record is created.
  consent_at              timestamptz NOT NULL,
  -- Set by the desk if this person later becomes a portal client. Old visits stay
  -- enquiries; this replaces the PRD's phone reconciliation.
  linked_portal_client_id uuid,
  linked_at               timestamptz,
  linked_by               uuid REFERENCES staff (id),
  -- Duplicate resolution: the surviving record's id. Rows are not deleted.
  merged_into_id          uuid REFERENCES visitor (id),
  -- Erasure request: personal fields are blanked, the row and its visits stay.
  anonymised_at           timestamptz,
  created_by              uuid NOT NULL REFERENCES staff (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  CHECK ((linked_portal_client_id IS NULL) = (linked_at IS NULL)),
  CHECK ((linked_portal_client_id IS NULL) = (linked_by IS NULL))
);

-- One live record per phone number. Merged records free their number.
CREATE UNIQUE INDEX visitor_phone_live_key ON visitor (phone)
  WHERE phone IS NOT NULL AND merged_into_id IS NULL;
CREATE INDEX visitor_name_idx ON visitor (lower(display_name));

CREATE TRIGGER visitor_touch_updated_at
  BEFORE UPDATE ON visitor
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

CREATE TABLE visit (
  id                uuid PRIMARY KEY,
  visitor_type_code text NOT NULL REFERENCES visitor_type (code),
  reason_code       text NOT NULL REFERENCES visit_reason (code),

  -- WHO. Exactly one of the two identities is set.
  --  portal_client_id    the portal's client id (a UUID in the portal's database,
  --                      so deliberately NO foreign key). The desk never sees it.
  --  client_name_logged  the name AS LOGGED at the desk, like a signature in a
  --                      visitor book. It is the ONE deliberate copy of portal
  --                      data: lists, exports and frequency reports cannot make a
  --                      portal call per row, and history must survive the portal
  --                      returning 404 for a client. NEVER refreshed. Screen 05
  --                      shows the LIVE portal name, not this one.
  --  visitor_id          a non-client.
  portal_client_id   uuid,
  client_name_logged text CHECK (client_name_logged IS NULL OR btrim(client_name_logged) <> ''),
  visitor_id         uuid REFERENCES visitor (id),

  -- How identity was established. MATCHED is the only outcome with a portal client.
  -- NOT_LOOKED_UP: a non-client type, no search. NO_MATCH: searched, nobody chosen.
  -- PORTAL_UNAVAILABLE: the lookup failed; the desk went on without verification
  -- (check-in must not depend on the portal being up).
  lookup_outcome text NOT NULL CHECK (lookup_outcome IN
    ('MATCHED', 'NO_MATCH', 'NOT_LOOKED_UP', 'PORTAL_UNAVAILABLE')),

  to_see text,  -- who they came to see (investor, delivery, visitor)

  checked_in_at  timestamptz NOT NULL DEFAULT now(),
  checked_in_by  uuid NOT NULL REFERENCES staff (id),
  checked_out_at timestamptz,
  -- NULL for AUTO_CLOSED (a visit nobody checked out, closed by policy).
  checked_out_by uuid REFERENCES staff (id),
  close_reason   text CHECK (close_reason IN ('NORMAL', 'NO_SHOW', 'AUTO_CLOSED')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK ((portal_client_id IS NULL) <> (visitor_id IS NULL)),
  CHECK ((portal_client_id IS NULL) = (client_name_logged IS NULL)),
  CHECK ((lookup_outcome = 'MATCHED') = (portal_client_id IS NOT NULL)),
  CHECK ((checked_out_at IS NULL) = (close_reason IS NULL)),
  CHECK (checked_out_by IS NULL OR checked_out_at IS NOT NULL),
  CHECK (close_reason IS NULL OR close_reason = 'AUTO_CLOSED' OR checked_out_by IS NOT NULL),
  CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at),
  -- Only a Client type is ever matched against the portal.
  CHECK (lookup_outcome <> 'MATCHED' OR visitor_type_code = 'CLIENT'),
  -- Targets for the composite foreign keys in 004 (enquiry) and 008 (case link),
  -- which make "a non-client never gets a case" and "an enquiry is never a
  -- client's" true in the database, not only in the application.
  UNIQUE (id, visitor_id),
  UNIQUE (id, portal_client_id)
);

-- The Active Visits list.
CREATE INDEX visit_active_idx ON visit (checked_in_at) WHERE checked_out_at IS NULL;
CREATE INDEX visit_checked_in_idx ON visit (checked_in_at);
-- Visit frequency per person (GROUP BY the identity).
CREATE INDEX visit_client_idx ON visit (portal_client_id, checked_in_at)
  WHERE portal_client_id IS NOT NULL;
CREATE INDEX visit_visitor_idx ON visit (visitor_id, checked_in_at)
  WHERE visitor_id IS NOT NULL;

CREATE TRIGGER visit_touch_updated_at
  BEFORE UPDATE ON visit
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

-- The visit timeline, append-only. Check-in and check-out are NOT events: they
-- are columns of visit, and the timeline shows them as synthetic entries, so the
-- same fact is never written twice. payload carries ids only, never client data.
CREATE TABLE visit_event (
  id             uuid PRIMARY KEY,
  visit_id       uuid NOT NULL REFERENCES visit (id),
  kind           text NOT NULL CHECK (kind IN
    ('NOTE', 'EDITED', 'ENQUIRY_LOGGED', 'CASE_LINKED', 'HANDOVER_RECORDED')),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_staff_id uuid NOT NULL REFERENCES staff (id),
  body           text,
  payload        jsonb,
  CHECK (kind <> 'NOTE' OR (body IS NOT NULL AND btrim(body) <> ''))
);

CREATE INDEX visit_event_visit_idx ON visit_event (visit_id, occurred_at);

CREATE TRIGGER visit_event_no_row_change
  BEFORE UPDATE OR DELETE ON visit_event
  FOR EACH ROW EXECUTE PROCEDURE forbid_change();
CREATE TRIGGER visit_event_no_truncate
  BEFORE TRUNCATE ON visit_event
  FOR EACH STATEMENT EXECUTE PROCEDURE forbid_change();

COMMIT;
