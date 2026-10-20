-- 004 enquiries: what a NON-CLIENT raises at the desk (CLAUDE.md rule 3).
--
-- A non-client gets an ENQUIRY in CSS's own log, never a portal case. Two states
-- only, OPEN and CLOSED; no further workflow (owner's decision).
--
-- The composite foreign key (visit_id, visitor_id) -> visit (id, visitor_id) is
-- the point of this file: visitor_id is NOT NULL here, and a visit that belongs
-- to a portal client has visitor_id NULL, so it can never match. An enquiry on a
-- client's visit is rejected by the database.

BEGIN;

CREATE TABLE enquiry (
  id           uuid PRIMARY KEY,
  visit_id     uuid NOT NULL,
  visitor_id   uuid NOT NULL,
  topic_code   text NOT NULL REFERENCES enquiry_topic (code),
  summary      text NOT NULL
    CONSTRAINT enquiry_summary_not_blank_check CHECK (btrim(summary) <> ''),
  status       text NOT NULL DEFAULT 'OPEN'
    CONSTRAINT enquiry_status_valid_check CHECK (status IN ('OPEN', 'CLOSED')),
  assigned_to  uuid REFERENCES staff (id),
  opened_by    uuid NOT NULL REFERENCES staff (id),
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_by    uuid REFERENCES staff (id),
  closed_at    timestamptz,
  outcome_note text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enquiry_visit_is_non_client_fkey
    FOREIGN KEY (visit_id, visitor_id) REFERENCES visit (id, visitor_id),
  CONSTRAINT enquiry_closed_at_matches_status_check
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT enquiry_closed_by_matches_status_check
    CHECK ((status = 'CLOSED') = (closed_by IS NOT NULL)),
  CONSTRAINT enquiry_closed_after_opened_check
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE INDEX enquiry_open_idx ON enquiry (opened_at) WHERE status = 'OPEN';
CREATE INDEX enquiry_visit_idx ON enquiry (visit_id);
CREATE INDEX enquiry_visitor_idx ON enquiry (visitor_id);

CREATE TRIGGER enquiry_touch_updated_at
  BEFORE UPDATE ON enquiry
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

COMMIT;
