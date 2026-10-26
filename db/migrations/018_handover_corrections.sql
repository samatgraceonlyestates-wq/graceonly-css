-- 018 document handovers: client-only in the database, and corrections that APPEND.
--
-- A handover is the record that documents physically left the building (007). handover and
-- handover_item are APPEND-ONLY and stay so: the triggers of 007 are not touched here. But a
-- desk that cannot fix a mistake keeps a second paper list, so a mistake is answered by a NEW
-- row that points at the old one, never by changing it.
--
-- THE SHAPE, AND WHY.
--  1. handover_correction: a separate, append-only table. One row says "the handover record
--     <handover_id> is wrong", with the reason, who said so and when. The original row and its
--     items stay exactly as written; a correction WITHDRAWS the record (it no longer counts as a
--     release anywhere) and every list shows the original WITH its correction.
--     Not a status column on handover: that would need an UPDATE, which is what the triggers
--     exist to refuse. Not a "correcting" handover row (a self-reference with a kind): a handover
--     row asserts that documents left at released_at, released by someone, under a gate answer
--     the portal gave; a correction asserts none of that, so its gate_answer and released_by
--     would have to be faked, and every count would have to filter kinds. A correction is a
--     statement ABOUT a record, by a person, with a reason: it gets its own table.
--     At most ONE correction per handover (handover_correction_once_key): a withdrawal is final.
--     A withdrawal made by mistake is answered the same way as any other mistake: record the
--     handover again.
--  2. handover.replaces_handover_id: when the release DID happen but was recorded wrongly (two
--     copies, not one; the wrong document), the right one is recorded as a NEW handover, which
--     runs the portal's release-check again at that moment (a correction can never carry an old
--     gate answer onto different documents), and names the withdrawn record it replaces. It is
--     written once, on INSERT, so it needs no UPDATE. A record can be replaced once.
--
-- CLIENT ONLY, IN THE DATABASE. A non-client cannot receive documents. handover gets
-- portal_client_id, and a composite foreign key to visit (id, portal_client_id), the same
-- pattern as case_request (008): a visitor's visit has no portal_client_id, so no handover can
-- reference it. NOT NULL with no default: it fails loudly if any handover row exists, which none
-- does (nothing has written one: 007's tables had no screen until now).
--
-- 007's comment said the application offers "record a handover" only on CHECKED_ALLOWED or
-- NOT_GATED. The owner decided otherwise (see CLAUDE.md, "Document handovers"): a handover made
-- while the gate is OFF or the portal UNAVAILABLE is recorded AS SUCH, plainly unverified,
-- because the documents left either way; CHECKED_BLOCKED stops the desk recording it.

BEGIN;

ALTER TABLE handover
  ADD COLUMN portal_client_id uuid NOT NULL,
  ADD COLUMN replaces_handover_id uuid;

ALTER TABLE handover
  ADD CONSTRAINT handover_visit_is_client_fkey
    FOREIGN KEY (visit_id, portal_client_id) REFERENCES visit (id, portal_client_id);

ALTER TABLE handover
  ADD CONSTRAINT handover_replaces_handover_id_fkey
    FOREIGN KEY (replaces_handover_id) REFERENCES handover (id);

ALTER TABLE handover
  ADD CONSTRAINT handover_not_replacing_itself_check
    CHECK (replaces_handover_id IS NULL OR replaces_handover_id <> id);

-- A note, when there is one, is never blank (the application stores none instead).
ALTER TABLE handover
  ADD CONSTRAINT handover_note_not_blank_check
    CHECK (note IS NULL OR btrim(note) <> '');

CREATE UNIQUE INDEX handover_replaced_once_key ON handover (replaces_handover_id)
  WHERE replaces_handover_id IS NOT NULL;

CREATE TABLE handover_correction (
  id           uuid PRIMARY KEY,
  handover_id  uuid NOT NULL REFERENCES handover (id),
  reason       text NOT NULL
    CONSTRAINT handover_correction_reason_not_blank_check CHECK (btrim(reason) <> ''),
  corrected_by uuid NOT NULL REFERENCES staff (id),
  corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX handover_correction_once_key ON handover_correction (handover_id);

-- Append-only, like the record it corrects. The application's database role must also have no
-- UPDATE, DELETE or TRUNCATE on it (a deployment step, as for 007's tables).
CREATE TRIGGER handover_correction_no_row_change
  BEFORE UPDATE OR DELETE ON handover_correction
  FOR EACH ROW EXECUTE PROCEDURE forbid_change();
CREATE TRIGGER handover_correction_no_truncate
  BEFORE TRUNCATE ON handover_correction
  FOR EACH STATEMENT EXECUTE PROCEDURE forbid_change();

COMMIT;
