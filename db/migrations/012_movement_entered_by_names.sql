-- 012 one naming pattern for "who typed it": <event>_entered_by.
--
-- attendance_record already follows it (clock_in_entered_by, clock_out_entered_by,
-- from 010 and 011). movement did not: 010 named the author of the departure
-- entered_by, and 011 named the author of the return returned_recorded_by. Both
-- now say which EVENT they belong to, in the same shape.
--
--   movement.entered_by           ->  left_entered_by       (who typed the departure)
--   movement.returned_recorded_by ->  returned_entered_by   (who typed the return)
--
-- This is a new migration and not an edit to 010 or 011, even though the server has
-- neither yet: both are applied to the local database that holds the owner's login,
-- which cannot be rebuilt, and a migration file must describe a schema that exists.
--
-- As in 011, a column rename leaves its foreign key's and check's NAMES alone, and a
-- constraint name is part of the application's contract (dbConstraints.ts), so each
-- is renamed to match. Nothing else changes: no column, type, nullability or rule.
-- (movement.entered_device_id and entered_device_kind keep their names: they record
-- the machine the departure was entered on, as attendance_record's device columns do.)

BEGIN;

ALTER TABLE movement RENAME COLUMN entered_by TO left_entered_by;
ALTER TABLE movement RENAME CONSTRAINT movement_entered_by_fkey TO movement_left_entered_by_fkey;

ALTER TABLE movement RENAME COLUMN returned_recorded_by TO returned_entered_by;
ALTER TABLE movement RENAME CONSTRAINT movement_returned_recorded_by_fkey TO movement_returned_entered_by_fkey;
ALTER TABLE movement RENAME CONSTRAINT movement_returned_recorded_by_matches_check TO movement_returned_entered_by_matches_check;

COMMIT;
