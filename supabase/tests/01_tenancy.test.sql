-- Tenancy and row level security.
--
-- These assertions are written over the catalogue rather than over a list of
-- table names, so a table added in a later migration without owner_id, without
-- forced RLS, or with a privilege for anon fails this file without anyone
-- remembering to update it.

begin;
select * from no_plan();

-- Structure ----------------------------------------------------------------

select is_empty($$
  select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not exists (
       select 1 from pg_attribute a
        where a.attrelid = c.oid
          and a.attname = 'owner_id'
          and a.attnum > 0
          and not a.attisdropped
     )
$$, 'every table in public carries owner_id');

select is_empty($$
  select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
$$, 'row level security is enabled on every table in public');

select is_empty($$
  select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relforcerowsecurity
$$, 'row level security is forced on every table in public');

select is_empty($$
  select a.attrelid::regclass::text
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and a.attname = 'owner_id'
     and not a.attnotnull
$$, 'owner_id is NOT NULL on every table in public');


-- Layer 1 and 2: anon holds no privilege anywhere ---------------------------

select is_empty($$
  select t.tablename || ' ' || p.priv
    from pg_tables t
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
   where t.schemaname = 'public'
     and has_table_privilege('anon', format('public.%I', t.tablename), p.priv)
$$, 'anon holds no table privilege on anything in public');

-- The default-privilege revoke in the first migration is what makes this true
-- for tables that do not exist yet.
create table public.tenancy_probe (id integer, owner_id uuid);
select ok(
  not has_table_privilege('anon', 'public.tenancy_probe', 'SELECT'),
  'a table created after the lockdown grants anon nothing by default'
);
drop table public.tenancy_probe;


-- Layer 3: the restrictive deny-anon policy --------------------------------

select is_empty($$
  select t.tablename::text
    from pg_tables t
   where t.schemaname = 'public'
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = t.tablename
          and p.permissive = 'RESTRICTIVE'
          and p.roles @> array['anon']::name[]
     )
$$, 'every table has a restrictive policy denying anon');

-- No permissive policy anywhere names anon or PUBLIC.
select is_empty($$
  select p.tablename || '.' || p.policyname
    from pg_policies p
   where p.schemaname = 'public'
     and p.permissive = 'PERMISSIVE'
     and (p.roles @> array['anon']::name[] or p.roles @> array['public']::name[])
$$, 'no permissive policy is granted to anon or to PUBLIC');


-- Fixtures ------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.test');

select is(
  (select count(*)::integer from public.accounts
    where owner_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'an account row is created for a new auth user by trigger'
);

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'garden-party', 'Garden Party', 1,
  '{"version": 1, "blocks": []}'::jsonb,
  '{"version": 1, "tokens": {}}'::jsonb
);

insert into public.events (
  id, owner_id, template_id, template_definition_version,
  slug, title, status, starts_at_local, time_zone, hosting_expires_at, published_at
)
values (
  '44444444-4444-4444-4444-444444444444',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333', 1,
  'owner-event-abc123', 'Owner Event', 'published',
  '2027-01-15 15:00', 'Australia/Melbourne', now() + interval '365 days', now()
);

insert into public.rsvps (owner_id, event_id, attendance, party_size, guest_name, dietary_notes)
values (
  '11111111-1111-1111-1111-111111111111',
  '44444444-4444-4444-4444-444444444444',
  'attending', 2, 'Priya Raman', 'coeliac'
);


-- anon, in-database --------------------------------------------------------

set local role anon;

select throws_ok(
  'select * from public.rsvps',
  '42501',
  null,
  'anon cannot read rsvps'
);

select throws_ok(
  'select * from public.events',
  '42501',
  null,
  'anon cannot read events'
);

select throws_ok(
  $$insert into public.events (owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1, 'anon-written-xyz789', 'Anon', '2027-01-01 10:00', 'UTC', now() + interval '1 day')$$,
  '42501',
  null,
  'anon cannot write to events'
);

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size, guest_name)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'attending', 1, 'Anon Guest')$$,
  '42501',
  null,
  'anon cannot write to rsvps'
);

reset role;


-- The owner, as authenticated ----------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.events),
  1,
  'the owner sees their own event'
);

select is(
  (select guest_name from public.rsvps limit 1),
  'Priya Raman',
  'the owner reads the guest name on their own RSVP'
);

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size, guest_name)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'attending', 1, 'Self Served')$$,
  '42501',
  null,
  'even the owner cannot insert an RSVP directly: that path is the service role'
);

reset role;
reset request.jwt.claims;


-- A signed-in stranger ------------------------------------------------------
-- This is the failure a single-tenant product finds out about in production.

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.events),
  0,
  'a signed-in stranger sees no events belonging to someone else'
);

select is(
  (select count(*)::integer from public.rsvps),
  0,
  'a signed-in stranger sees no RSVPs belonging to someone else'
);

select is(
  (select count(*)::integer from public.accounts),
  1,
  'a signed-in stranger sees only their own account row'
);

select is(
  (select count(*)::integer from public.templates),
  0,
  'a signed-in stranger sees no templates belonging to someone else'
);

reset role;
reset request.jwt.claims;

select * from finish();
rollback;
