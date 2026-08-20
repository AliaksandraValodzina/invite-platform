-- The serving state, read the way a guest page reads it.
--
-- public.event_state_at is already covered as a function. What is new here is
-- the computed column the read path selects, and the thing worth asserting
-- about it is that it agrees with the function on every row rather than being a
-- second implementation that happens to look similar.

begin;
select * from no_plan();

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'owner@example.test');

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'serving-state', 'Serving state', 1,
  '{"version": 1, "blocks": []}'::jsonb,
  '{"version": 1, "tokens": {}}'::jsonb
);

-- One row per state, each made by a pair of timestamps either side of now,
-- because no column stores which state a row is in.
insert into public.events (
  id, owner_id, template_id, template_definition_version, slug, title,
  status, starts_at_local, time_zone, hosting_expires_at, grace_ends_at
)
values
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'state-draft-aaa001', 'Draft',
   'draft', '2027-01-15 15:00', 'Australia/Sydney', now() + interval '365 days', now() + interval '395 days'),
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'state-live-aaa002', 'Live',
   'published', '2027-01-15 15:00', 'Australia/Sydney', now() + interval '365 days', now() + interval '395 days'),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'state-grace-aaa003', 'Grace',
   'published', '2027-01-15 15:00', 'Australia/Sydney', now() - interval '1 day', now() + interval '29 days'),
  ('44444444-4444-4444-4444-444444444404', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'state-expired-aaa004', 'Expired',
   'published', '2027-01-15 15:00', 'Australia/Sydney', now() - interval '32 days', now() - interval '2 days');


select is(
  (select public.serving_state(e) from public.events e where e.slug = 'state-draft-aaa001'),
  'unpublished'::public.event_serving_state,
  'a draft event serves the designed unpublished page, whatever its dates say'
);

select is(
  (select public.serving_state(e) from public.events e where e.slug = 'state-live-aaa002'),
  'live'::public.event_serving_state,
  'a published event inside its hosting term is live'
);

select is(
  (select public.serving_state(e) from public.events e where e.slug = 'state-grace-aaa003'),
  'grace'::public.event_serving_state,
  'hosting lapsed but grace not ended still serves the page, so a shared link does not break mid event'
);

select is(
  (select public.serving_state(e) from public.events e where e.slug = 'state-expired-aaa004'),
  'expired'::public.event_serving_state,
  'past grace serves the designed expiry page'
);

-- The point of the column is that it is not a second opinion. If it ever stops
-- delegating, this is what says so.
select is_empty(
  $$select e.slug
      from public.events e
     where public.serving_state(e)
           is distinct from public.event_state_at(e.status, e.hosting_expires_at, e.grace_ends_at, now())$$,
  'the computed column agrees with public.event_state_at on every row'
);

-- Nothing was written by reading. Expiry is derived, and the first write it
-- causes is the retention sweep, thirty days after grace ends.
select is(
  (select count(*)::integer from public.events e where e.updated_at <> e.created_at),
  0,
  'reading the serving state writes nothing to the row'
);

select ok(
  not has_function_privilege('anon', 'public.serving_state(public.events)', 'execute'),
  'anon cannot execute the serving state function: guest pages come through the service role'
);

select ok(
  has_function_privilege('service_role', 'public.serving_state(public.events)', 'execute'),
  'the service role can, because that is the role the guest page read runs as'
);

select * from finish();
rollback;
