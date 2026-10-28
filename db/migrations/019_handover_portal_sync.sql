-- 019_handover_portal_sync.sql
--
-- Tracks whether a local handover record has been synced to the portal's document
-- release endpoint. The handover table itself is append-only (007 triggers refuse
-- UPDATE/DELETE): this table sits BESIDE it and CAN be updated for retries.
--
-- One row per handover. Created when the first portal sync is attempted (right
-- after the local handover is written). Updated on retry.

BEGIN;

CREATE TABLE handover_portal_sync (
  handover_id       uuid NOT NULL,
  portal_release_id text,
  synced_at         timestamptz,
  last_error        text,
  last_attempt_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT handover_portal_sync_pkey PRIMARY KEY (handover_id),
  CONSTRAINT handover_portal_sync_handover_fkey FOREIGN KEY (handover_id) REFERENCES handover(id)
);

COMMIT;
