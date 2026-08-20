-- Storing a reply: what public.submit_rsvp accepts, and what it refuses.
--
-- The refusals are the point. A guest page is cached for up to a minute
-- (src/lib/serving/cache.ts), so the form a guest is looking at can be a minute
-- out of date about whether replies are still open. This function is what makes
-- that safe, by reading the serving state inside the transaction that does the
-- write.

begin;
select * from no_plan();

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'owner@example.test');

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'garden-party', 'Garden Party', 1,
  '{"version": 1, "blocks": []}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb
);

insert into public.events (id, owner_id, template_id, template_definition_version, slug, title, status, starts_at_local, time_zone, hosting_expires_at, grace_ends_at, published_at)
values
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'open-invite-aaa111', 'Open', 'published',
   '2027-01-15 15:00', 'UTC', now() + interval '365 days', now() + interval '395 days', now()),
  -- hosting lapsed yesterday: the page still serves, replies do not
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'grace-invite-aaa222', 'Grace', 'published',
   '2027-01-15 15:00', 'UTC', now() - interval '1 day', now() + interval '29 days', now()),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'draft-invite-aaa333', 'Draft', 'draft',
   '2027-01-15 15:00', 'UTC', now() + interval '365 days', now() + interval '395 days', null);

insert into public.rsvp_questions (id, owner_id, event_id, type, prompt, position, required, pii_class, options)
values
  ('66666666-6666-6666-6666-666666666601', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444401', 'short_answer', 'Your name', 1, true, 'identity', null),
  ('66666666-6666-6666-6666-666666666602', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444401', 'long_answer', 'Anything we should know about food?', 2, false, 'sensitive', null),
  ('66666666-6666-6666-6666-666666666603', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444401', 'checkbox', 'Which events will you be at?', 3, false, 'none',
   '[{"value": "ceremony", "label": "Ceremony"}, {"value": "dinner", "label": "Dinner"}]'::jsonb),
  -- Belongs to a different event, which is the id an attacker would try.
  ('66666666-6666-6666-6666-666666666604', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444402', 'short_answer', 'Your name', 1, true, 'identity', null);


-- The happy path -------------------------------------------------------------

select is(
  public.submit_rsvp(
    'open-invite-aaa111', 'attending', 2,
    '[{"question_id": "66666666-6666-6666-6666-666666666601", "value_text": "Priya Raman"},
      {"question_id": "66666666-6666-6666-6666-666666666602", "value_text": "coeliac"},
      {"question_id": "66666666-6666-6666-6666-666666666603", "value_choice": ["ceremony", "dinner"]}]'::jsonb
  ) - 'rsvp_id',
  jsonb_build_object('answers_stored', 3, 'answers_skipped', 0),
  'a reply and all three of its answers are stored'
);

select is(
  (select attendance::text || ' ' || party_size::text from public.rsvps limit 1),
  'attending 2',
  'the envelope carries the attendance and the party size'
);

select is(
  (select value_text from public.rsvp_answers where question_id = '66666666-6666-6666-6666-666666666601'),
  'Priya Raman',
  'the text answer is stored in the text column'
);

select is(
  (select value_choice from public.rsvp_answers where question_id = '66666666-6666-6666-6666-666666666603'),
  array['ceremony', 'dinner'],
  'the choice answer is stored in the choice column'
);

-- The snapshot comes from the question row, not from the caller. This is what
-- stops the column the retention sweep reads from being a value the caller
-- chose.
select is(
  (select pii_class::text from public.rsvp_answers where question_id = '66666666-6666-6666-6666-666666666602'),
  'sensitive',
  'the PII class is copied from the question, so the caller cannot classify their own answer'
);

select is(
  (select question_prompt from public.rsvp_answers where question_id = '66666666-6666-6666-6666-666666666602'),
  'Anything we should know about food?',
  'and so is the prompt the guest actually read'
);

select is(
  (select count(distinct owner_id)::integer from public.rsvp_answers),
  1,
  'every answer belongs to the event owner, taken from the event and not from the call'
);

-- A decline brings nobody, whatever the caller sends, because
-- `rsvps_declines_bring_nobody` would otherwise reject the row after the guest
-- pressed the button.
select is(
  (public.submit_rsvp(
    'open-invite-aaa111', 'not_attending', 4,
    '[{"question_id": "66666666-6666-6666-6666-666666666601", "value_text": "Jo Fitzgerald"}]'::jsonb
  ) is not null),
  true,
  'a decline is storable even when the form sent a party size'
);

select is(
  (select party_size from public.rsvps where attendance = 'not_attending'),
  0,
  'and it brings nobody'
);


-- The refusals ---------------------------------------------------------------

select throws_ok(
  $$select public.submit_rsvp('no-such-invite-aaa999', 'attending', 1, '[]'::jsonb)$$,
  'RS404',
  null,
  'a slug with no event is refused'
);

select throws_ok(
  $$select public.submit_rsvp('grace-invite-aaa222', 'attending', 1,
      '[{"question_id": "66666666-6666-6666-6666-666666666604", "value_text": "Too Late"}]'::jsonb)$$,
  'RS409',
  null,
  'an event whose hosting has lapsed takes no more replies, even though its page still serves'
);

select throws_ok(
  $$select public.submit_rsvp('draft-invite-aaa333', 'attending', 1, '[]'::jsonb)$$,
  'RS409',
  null,
  'an unpublished event takes no replies'
);

select throws_ok(
  $$select public.submit_rsvp('open-invite-aaa111', 'attending', 1,
      '[{"question_id": "66666666-6666-6666-6666-666666666604", "value_text": "Wrong event"}]'::jsonb)$$,
  'RS422',
  null,
  'an answer naming another event question is refused rather than stored'
);

-- Nothing above should have been written. Read it back rather than assuming: a
-- function that raised after inserting the envelope would leave a reply from
-- nobody, which is the failure this function exists to make impossible.
select is(
  (select count(*)::integer from public.rsvps),
  2,
  'a refused submission writes nothing at all, not even the envelope'
);


-- The race the buyer can cause ----------------------------------------------
-- A question retired between the page rendering and the guest pressing send.
-- Losing that answer is right; losing the whole reply is not.

update public.rsvp_questions set retired_at = now()
 where id = '66666666-6666-6666-6666-666666666602';

select is(
  public.submit_rsvp(
    'open-invite-aaa111', 'attending', 1,
    '[{"question_id": "66666666-6666-6666-6666-666666666601", "value_text": "Marcus Webb"},
      {"question_id": "66666666-6666-6666-6666-666666666602", "value_text": "severe nut allergy"}]'::jsonb
  ) - 'rsvp_id',
  jsonb_build_object('answers_stored', 1, 'answers_skipped', 1),
  'an answer to a question retired since the page loaded is skipped, and the reply is still stored'
);

select is(
  (select count(*)::integer from public.rsvp_answers
    where question_id = '66666666-6666-6666-6666-666666666602' and value_text = 'severe nut allergy'),
  0,
  'and nothing was stored against the retired question'
);


-- Who may call it ------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$select public.submit_rsvp('open-invite-aaa111', 'attending', 1, '[]'::jsonb)$$,
  '42501',
  null,
  'a signed-in buyer cannot call the write path: it is the service role, from an API route'
);

reset role;
reset request.jwt.claims;

set local role anon;

select throws_ok(
  $$select public.submit_rsvp('open-invite-aaa111', 'attending', 1, '[]'::jsonb)$$,
  '42501',
  null,
  'and neither can anon, so a guest reaching PostgREST directly gets nowhere'
);

reset role;

select * from finish();
rollback;
