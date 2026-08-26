-- One published invitation at a time, per account.
--
-- The captain's decision of 2026-08-24, and it stopped being a sentence and
-- became a rule the day the other decision of 2026-08-24 opened the copy link.
-- `/t/<templateId>/use` mints a copy for anybody who signs in, so the number of
-- invitations one account can hold is deliberately unbounded. This is the only
-- thing between one free template and somebody running a wedding business on
-- it, and every published event costs hosting for its whole term.
--
-- It is asserted here rather than only through the editor because the editor is
-- not the only way to reach it. A buyer holds their own access token; PostgREST
-- will take `PATCH /events?id=eq...` with `{"status":"published"}` from it, with
-- no page in the middle. A limit that only the publish button applies is a
-- limit, in the words of AGENTS.md about upload caps, that a route check can be
-- raced or skipped.

begin;
select * from no_plan();

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'seller@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'buyer@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'other-buyer@example.test');

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '44444444-4444-4444-4444-444444444444',
  '11111111-1111-1111-1111-111111111111',
  'free-launch', 'Free launch', 1,
  '{"version": 1, "blocks": []}'::jsonb,
  '{"version": 1, "tokens": {}}'::jsonb
);

-- Three copies of one free template, which is what the open link produces.
-- Drafts, as every copy is: publishing is the buyer's own separate decision.
insert into public.events (
  id, owner_id, template_id, template_definition_version, slug, title,
  status, starts_at_local, time_zone, hosting_expires_at
)
values
  ('55555555-5555-5555-5555-555555555501', '22222222-2222-2222-2222-222222222222',
   '44444444-4444-4444-4444-444444444444', 1, 'first-copy-aaa001', 'The first copy',
   'draft', '2027-01-15 15:00', 'Australia/Sydney', now() + interval '365 days'),
  ('55555555-5555-5555-5555-555555555502', '22222222-2222-2222-2222-222222222222',
   '44444444-4444-4444-4444-444444444444', 1, 'second-copy-aaa002', 'The second copy',
   'draft', '2027-01-15 15:00', 'Australia/Sydney', now() + interval '365 days'),
  ('55555555-5555-5555-5555-555555555503', '22222222-2222-2222-2222-222222222222',
   '44444444-4444-4444-4444-444444444444', 1, 'third-copy-aaa003', 'The third copy',
   'draft', '2027-01-15 15:00', 'Australia/Sydney', now() + interval '365 days');


-- The buyer, as their own token reaches the database -------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select lives_ok(
  $$update public.events set status = 'published' where id = '55555555-5555-5555-5555-555555555501'$$,
  'the first invitation publishes'
);

select throws_ok(
  $$update public.events set status = 'published' where id = '55555555-5555-5555-5555-555555555502'$$,
  '23505',
  null,
  'a second published invitation on the same account is refused'
);

select is(
  (select count(*) from public.events
    where owner_id = '22222222-2222-2222-2222-222222222222' and status = 'published'),
  1::bigint,
  'and the refusal left one published invitation, not two'
);

-- Unlimited drafts and copies is the other half of the decision, and it is the
-- half the open copy link depends on. A refusal here would make the free launch
-- a one-invitation-per-person product.
select lives_ok(
  $$insert into public.events (
      owner_id, template_id, template_definition_version, slug, title,
      status, starts_at_local, time_zone, hosting_expires_at
    ) values (
      '22222222-2222-2222-2222-222222222222',
      '44444444-4444-4444-4444-444444444444', 1, 'fourth-copy-aaa004', 'The fourth copy',
      'draft', '2027-01-15 15:00', 'Australia/Sydney', now() + interval '365 days'
    )$$,
  'another copy can still be made while one invitation is published'
);

-- Editing the published invitation is not publishing it a second time. The
-- trigger fires on every write to a published row, so getting this wrong would
-- stop a buyer saving a date on the page that is already live.
select lives_ok(
  $$update public.events set title = 'The first copy, renamed'
      where id = '55555555-5555-5555-5555-555555555501'$$,
  'the published invitation can still be edited'
);

select lives_ok(
  $$update public.events set status = 'published'
      where id = '55555555-5555-5555-5555-555555555501'$$,
  'and publishing the one that is already published is not a second publication'
);

-- The way through, which is what the editor tells the buyer to do.
select lives_ok(
  $$update public.events set status = 'draft' where id = '55555555-5555-5555-5555-555555555501'$$,
  'the live invitation comes down'
);

select lives_ok(
  $$update public.events set status = 'published' where id = '55555555-5555-5555-5555-555555555502'$$,
  'and now the other one goes up'
);

reset role;
reset request.jwt.claims;


-- Another account is another account -----------------------------------------
--
-- The limit is per owner. Two people each publishing one invitation is the
-- product working, and a limit that counted rows globally would be a bug that
-- only appeared once there were two customers.

insert into public.events (
  id, owner_id, template_id, template_definition_version, slug, title,
  status, starts_at_local, time_zone, hosting_expires_at
)
values (
  '66666666-6666-6666-6666-666666666601', '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444', 1, 'someone-else-aaa001', 'Somebody else',
  'draft', '2027-01-15 15:00', 'Australia/Sydney', now() + interval '365 days'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select lives_ok(
  $$update public.events set status = 'published' where id = '66666666-6666-6666-6666-666666666601'$$,
  'a different account publishes its own invitation regardless'
);

reset role;
reset request.jwt.claims;


-- The boundary, stated rather than discovered ---------------------------------
--
-- The limit is enforced against `authenticated`, which is every path a buyer
-- can reach. The platform's own key is outside it on purpose: seeding the four
-- serving-state fixtures the guest page suite is drawn from, and a support
-- action putting somebody's second page back up while an order is sorted out,
-- are decisions a person made with the platform's key. They are not a buyer
-- dodging a limit. Asserting it here is what stops that being mistaken for an
-- oversight later.

select lives_ok(
  $$update public.events set status = 'published' where id = '55555555-5555-5555-5555-555555555503'$$,
  'the platform can still publish a second page for an account'
);

select is(
  (select count(*) from public.events
    where owner_id = '22222222-2222-2222-2222-222222222222' and status = 'published'),
  2::bigint,
  'which is the boundary of the rule, not a hole a buyer can reach'
);

select * from finish();
rollback;
