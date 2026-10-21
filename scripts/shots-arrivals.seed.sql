-- Seeds a THROWAWAY schema, shot_e2e, for scripts/shots-arrivals.ts. LOCAL ONLY.
-- It lives in the owner's local database but never touches the real `public` schema
-- (CLAUDE.md: never drop or recreate `public`).
--
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS shot_e2e CASCADE; CREATE SCHEMA shot_e2e;"
--   for f in db/migrations/*.sql; do PGOPTIONS="-c search_path=shot_e2e" psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$f"; done
--   psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f scripts/shots-arrivals.seed.sql
--
-- Then run the scenario with SHOTS_DATABASE_URL set to the same URL plus
-- "?options=-c%20search_path%3Dshot_e2e" (see scripts/shots-arrivals.ts), and drop
-- the schema afterwards. gen_random_uuid() is PostgreSQL 13+: fine here (the local
-- server is 18); this file is never carried to the PG10 server.

-- The screenshot account, copied (hash and all) so its .env.local credentials work.
INSERT INTO shot_e2e.staff (id, email, full_name, department, password_hash, must_change_password)
  SELECT id, email, full_name, department, password_hash, false
    FROM public.staff WHERE email = 'screenshots@css.localhost';
INSERT INTO shot_e2e.staff_role (staff_id, role_code)
  SELECT staff_id, role_code FROM public.staff_role
   WHERE staff_id = (SELECT id FROM public.staff WHERE email = 'screenshots@css.localhost');

-- A roster of 24 people: no password, no email.
INSERT INTO shot_e2e.staff (id, full_name, department)
  SELECT gen_random_uuid(), n, d FROM (VALUES
    ('Divine Mike','Front desk'), ('Peter Obi','Admin'), ('Amaka Obi','Legal'), ('Chukwuemeka Eze','Partners'),
    ('Faith Udo','Partners'), ('Mariam Yusuf','Legal'), ('Blessing Ike','Finance'), ('Daniel Johnson','Admin'),
    ('Grace Nkem','HR'), ('Chidera Nnamdi','Legal'), ('Amaka Obi-Eze','Finance'), ('Tunde Bello','Finance'),
    ('Ngozi Adeyemi','Front desk'), ('Ifeanyi Okeke','Admin'), ('Zainab Musa','Partners'), ('Emeka Nwankwo','Finance'),
    ('Funke Adebisi','Legal'), ('Kelechi Ibe','Front desk'), ('Halima Garba','HR'), ('Obinna Eze','Partners'),
    ('Yetunde Cole','Finance'), ('Segun Alabi','Admin'), ('Ada Onuoha','Legal'), ('Musa Danjuma','Front desk')
  ) AS t(n, d);
