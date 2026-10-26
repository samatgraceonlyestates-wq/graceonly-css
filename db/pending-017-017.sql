-- ============================================================================
-- db/pending-017-017.sql  --  GENERATED FILE.  THIS IS NOT A MIGRATION.
--
-- Migrations 017 to 017 from db/migrations/, verbatim and in filename order, as ONE
-- file for the cPanel server, which ALREADY HAS 001 to 016 (it took, in order:
--   db/pg10-proof.sql (001-009)
--   db/pending-010-016.sql (010-016)
-- ). Apply it ONCE, on top of 001-016. Never on an empty database
-- (use pg10-proof.sql there), never twice, and never together with the separate
-- migration files it contains. It is not the proof file and never goes in
-- db/migrations/.
--
-- Do not edit it.  Regenerate:  node db/build-pending.mjs   (npm run db:pending)
--                  Is it stale: node db/build-pending.mjs --check
--
-- Run it with psql (the \echo and \set lines are psql commands):
--   psql -X -v ON_ERROR_STOP=1 -f pending-017-017.sql <connection>
-- Each migration keeps its own BEGIN/COMMIT; there is no outer transaction. If one
-- fails it rolls back, but the ones before it stay applied: the last
-- '>>> applying' line printed names the file that failed, and everything before it
-- is in. Fix the cause and apply the REMAINING migration files one at a time; do not
-- run this whole file again.
--
-- psql reports  psql:pending-017-017.sql:LINE: ERROR: ...  Find LINE below. The line
-- inside the source file is  LINE - first + 1.  Lines are counted in THIS file.
--
--   017_visit_corrections.sql        lines    31 -   102
-- ============================================================================
\set ON_ERROR_STOP on
\echo '>>> applying 017_visit_corrections.sql'
-- 017 the visitor log can be wrong too: corrections, removal, and one open visit each.
--
-- WHY. Check-in and check-out now write real visits (screens 03, 04, 05). The lesson from
-- attendance (014) and movements (015) was that a write path with no way to fix it makes
-- the front desk keep a second paper list. So `visit` gets the same correction columns,
-- BEFORE the first real visit is written rather than after.
--
-- The FULL history of every correction (before and after) is in audit_log. These columns
-- are only so a list can show AT A GLANCE that a visit was changed, by whom, when and why,
-- and they always describe the LATEST correction. correction_reason, corrected_at and
-- corrected_by come together or not at all, exactly as on attendance_record and movement.
--
-- REMOVED IS A VOID, NOT A DELETE (same reasoning as 014): the row stays, with its reason
-- and who removed it, so audit_log, visit_event and any later enquiry or handover still
-- point at something. A voided visit COUNTS FOR NOTHING: it is not "in the building", it is
-- in no count on the dashboard, and it does not stop the same person checking in again. The
-- indexes below exclude it; the application must exclude it from every query of its own.
--
-- ONE OPEN VISIT PER PERSON. A client (by portal id) or a non-client visitor (by visitor
-- row) can be checked in only once at a time: a second check-in while the first is open is
-- a double entry, not a second visit. The application checks it first (under a lock, and
-- names the open visit); these indexes are the backstop. Nothing has written a visit before
-- this migration, so they cannot fail on existing rows.
--
-- AUTO_CLOSED (003) is set only by an EXPLICIT end-of-day action that names the visits, and
-- checked_out_by then records who closed them; checked_out_at is when they were closed, NOT
-- when the visitor left, which nobody recorded. 003's constraints already allow that.

BEGIN;

ALTER TABLE visit
  ADD COLUMN correction_reason text,
  ADD COLUMN corrected_at timestamptz,
  ADD COLUMN corrected_by uuid,
  ADD COLUMN voided_at timestamptz;

ALTER TABLE visit
  ADD CONSTRAINT visit_corrected_by_fkey
    FOREIGN KEY (corrected_by) REFERENCES staff (id);

-- A reason, when present, is never blank (as attendance and movement).
ALTER TABLE visit
  ADD CONSTRAINT visit_correction_reason_not_blank_check
    CHECK (correction_reason IS NULL OR btrim(correction_reason) <> '');

-- When and by whom come together: a correction always says who made it.
ALTER TABLE visit
  ADD CONSTRAINT visit_corrected_pair_check
    CHECK ((corrected_at IS NULL) = (corrected_by IS NULL));

-- And with the reason: a reason without them, or them without a reason, is refused.
ALTER TABLE visit
  ADD CONSTRAINT visit_corrected_matches_reason_check
    CHECK ((correction_reason IS NULL) = (corrected_at IS NULL));

-- A removal is a correction: it carries the reason, the person and the time.
ALTER TABLE visit
  ADD CONSTRAINT visit_voided_needs_correction_check
    CHECK (voided_at IS NULL OR corrected_at IS NOT NULL);

-- Who they came to see, when given, is never blank (the application stores none instead).
ALTER TABLE visit
  ADD CONSTRAINT visit_to_see_not_blank_check
    CHECK (to_see IS NULL OR btrim(to_see) <> '');

CREATE UNIQUE INDEX visit_one_open_per_client_key ON visit (portal_client_id)
  WHERE checked_out_at IS NULL AND voided_at IS NULL AND portal_client_id IS NOT NULL;

CREATE UNIQUE INDEX visit_one_open_per_visitor_key ON visit (visitor_id)
  WHERE checked_out_at IS NULL AND voided_at IS NULL AND visitor_id IS NOT NULL;

COMMIT;
