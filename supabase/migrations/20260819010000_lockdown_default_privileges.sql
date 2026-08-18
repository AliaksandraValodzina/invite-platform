-- Tenancy lockdown, before any table exists.
--
-- Supabase ships default privileges that grant the `anon` role full table
-- privileges on everything created in `public`. Guest pages and RSVP inserts in
-- this product are served through API routes with the service role, so `anon`
-- must never hold a table privilege at all. Revoking the default here, in the
-- first migration, means no table added later can quietly inherit one.
--
-- This is the outermost of three layers. The other two live with each table:
-- row level security enabled and forced, and a restrictive policy that denies
-- `anon` explicitly so the intent survives someone re-granting by accident.

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
