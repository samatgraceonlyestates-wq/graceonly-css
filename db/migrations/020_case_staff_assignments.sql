-- 020_case_staff_assignments.sql
--
-- Logs CSS's OUTBOUND "Assign to staff" action: when the front desk assigns a
-- complaint/dispute to a colleague, CSS creates a task in the STAFF PORTAL (its
-- team:* API, a separate system from the client portal) and records HERE that it
-- did so, and to whom.
--
-- THIS TABLE DOES NOT STORE COMPLAINT DATA. The complaint is the client portal's
-- (CLAUDE.md rule 2): CSS keeps only
--   - case_id       the portal's opaque case id (a reference, like visit.portal_client_id
--                   or visit_case_link.case_id; never case content), and
--   - who it was assigned to in the STAFF portal (email + name: staff-portal people,
--     not clients), the staff-portal task id/link, and who here did the assigning.
-- So the "portal owns complaints" rule is intact.
--
-- NOT append-only and NOT a queue: one row per assignment, written once on a
-- successful task creation. A dispute can be assigned more than once (the
-- application asks for confirmation before a repeat; there is no silent de-dupe
-- here, and the staff portal's own idempotencyKey guards a replayed request).
--
-- Columns are all written by the application, never typed by a person:
--   id/assigned_at  application-generated;  assigned_by  the signed-in staff id;
--   assignee_*      picked from the staff portal's own list;  task_*  the portal's
--   answer;  priority  chosen from a fixed UI list.  None need an error mapping.

BEGIN;

CREATE TABLE case_staff_assignments (
  id             uuid        NOT NULL,
  -- The client portal's case id. Opaque text, no local case table to reference.
  case_id        text        NOT NULL,
  -- The staff-portal colleague the task was created for.
  assignee_email text        NOT NULL,
  assignee_name  text        NOT NULL,
  -- Optional, from a fixed UI list; NULL when not chosen.
  priority       text,
  -- The staff portal's task id and (optional) deep link to it.
  task_id        text        NOT NULL,
  task_link      text,
  -- Who, here, did the assigning (the signed-in user).
  assigned_by    uuid        NOT NULL REFERENCES staff (id),
  assigned_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT case_staff_assignments_pkey PRIMARY KEY (id)
);

-- Read path: a case's assignments, newest first.
CREATE INDEX case_staff_assignments_case_idx ON case_staff_assignments (case_id, assigned_at DESC);

COMMIT;
