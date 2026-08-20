-- RSVPs and the retention rule.
--
-- The assertions here read the values that survive and the values that are
-- gone, rather than checking that a sweep "ran". A sweep that updated a
-- timestamp and left the allergy notes in place would pass the second kind of
-- test and fail this one.
--
-- Since 20260821010000 a reply is an envelope plus answers: attendance and
-- party size on `rsvps`, everything the guest wrote in `rsvp_answers`. The
-- shape of those two tables is 07_rsvp_answers.test.sql. This file is about
-- what happens to them over time.

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

-- Three events at three points on the retention timeline.
insert into public.events (id, owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at, grace_ends_at)
values
  -- live
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'live-event-aaa111', 'Live',
   '2027-01-15 15:00', 'UTC', now() + interval '365 days', now() + interval '395 days'),
  -- grace ended 31 days ago: tier 1 is due
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'redact-me-aaa222', 'Redact Me',
   '2024-01-15 15:00', 'UTC', now() - interval '61 days', now() - interval '31 days'),
  -- grace ended 366 days ago: tier 2 is due
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'purge-me-aaa333', 'Purge Me',
   '2023-01-15 15:00', 'UTC', now() - interval '396 days', now() - interval '366 days'),
  -- grace ended 29 days ago: tier 1 is NOT yet due
  ('44444444-4444-4444-4444-444444444404', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'not-yet-aaa444', 'Not Yet',
   '2024-06-15 15:00', 'UTC', now() - interval '59 days', now() - interval '29 days');

-- One question set per event, mirroring what an event ships with: a name, an
-- email, a dietary note, and one question the buyer classed as holding nothing
-- about a person, which is the row that has to survive redaction.
insert into public.rsvp_questions (id, owner_id, event_id, type, prompt, position, required, pii_class, options)
select
  ('66666666-6666-6666-6666-6666666666' || lpad(((e.n - 1) * 4 + q.n)::text, 2, '0'))::uuid,
  '11111111-1111-1111-1111-111111111111',
  ('44444444-4444-4444-4444-44444444440' || e.n)::uuid,
  q.type::public.rsvp_question_type,
  q.prompt,
  q.n,
  q.n = 1,
  q.pii_class::public.rsvp_pii_class,
  q.options
from (values (1), (2), (3), (4)) as e(n)
cross join (values
  (1, 'short_answer', 'Your name', 'identity', null::jsonb),
  (2, 'email', 'Email', 'contact', null::jsonb),
  (3, 'long_answer', 'Anything we should know about food?', 'sensitive', null::jsonb),
  (4, 'multiple_choice', 'Main course', 'none',
   '[{"value": "fish", "label": "Fish"}, {"value": "beef", "label": "Beef"}]'::jsonb)
) as q(n, type, prompt, pii_class, options);


-- Envelope constraints ------------------------------------------------------

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'not_attending', 2)$$,
  '23514',
  null,
  'a decline cannot bring guests, so sum(party_size) is the headcount with no special case'
);

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'attending', 21)$$,
  '23514',
  null,
  'party size is bounded'
);


-- Fixtures ------------------------------------------------------------------

insert into public.rsvps (id, owner_id, event_id, attendance, party_size)
values
  ('55555555-5555-5555-5555-555555555501', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444401', 'attending', 2),
  ('55555555-5555-5555-5555-555555555502', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444402', 'attending', 3),
  ('55555555-5555-5555-5555-555555555503', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444402', 'not_attending', 0),
  ('55555555-5555-5555-5555-555555555504', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444403', 'attending', 1),
  ('55555555-5555-5555-5555-555555555505', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444404', 'attending', 4);

-- The answers. Written the way the API route writes them: the prompt, the type
-- and the class copied from the question onto the answer.
insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_text, value_choice)
select
  '11111111-1111-1111-1111-111111111111',
  r.event_id,
  r.id,
  q.id,
  q.prompt,
  q.type,
  q.pii_class,
  case when q.type = 'multiple_choice' then null else a.value end,
  case when q.type = 'multiple_choice' then array[a.value] else null end
from (values
  ('55555555-5555-5555-5555-555555555501'::uuid, 'Priya Raman', 'priya@example.test', 'coeliac', 'fish'),
  ('55555555-5555-5555-5555-555555555502'::uuid, 'Marcus Webb', 'marcus@example.test', 'severe nut allergy', 'beef'),
  ('55555555-5555-5555-5555-555555555503'::uuid, 'Jo Fitzgerald', 'jo@example.test', 'none', 'fish'),
  ('55555555-5555-5555-5555-555555555504'::uuid, 'Old Guest', 'old@example.test', 'vegetarian', 'beef'),
  ('55555555-5555-5555-5555-555555555505'::uuid, 'Recent Guest', 'recent@example.test', 'no pork', 'fish')
) as reply(rsvp_id, name, email, dietary, course)
join public.rsvps r on r.id = reply.rsvp_id
join public.rsvp_questions q on q.event_id = r.event_id
cross join lateral (
  select case q.position
    when 1 then reply.name
    when 2 then reply.email
    when 3 then reply.dietary
    else reply.course
  end as value
) as a;

-- owner_id is denormalised from the event, so a caller cannot claim someone
-- else's replies by writing a different value.
select is(
  (select owner_id from public.rsvps where id = '55555555-5555-5555-5555-555555555501'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'an RSVP owner_id comes from the parent event'
);

select is(
  (select count(distinct owner_id)::integer from public.rsvp_answers),
  1,
  'an answer owner_id comes from the parent event too'
);


-- Tier 1: redaction ---------------------------------------------------------

-- Two replies on the event 31 days past grace, one on the event 366 days past
-- grace. The tier 2 event is redacted first and deleted second: tier 1 does not
-- skip rows just because tier 2 is about to remove them.
select is(
  public.redact_expired_rsvp_pii(now()),
  jsonb_build_object('replies', 3, 'answers', 12),
  'tier 1 sweeps exactly the replies whose event passed grace more than 30 days ago, and every answer on them'
);

select is(
  (select string_agg(a.value_text, '|' order by a.question_prompt)
     from public.rsvp_answers a
    where a.rsvp_id = '55555555-5555-5555-5555-555555555501'
      and a.value_text is not null),
  'coeliac|priya@example.test|Priya Raman',
  'a live event keeps every answer'
);

select is(
  (select count(*)::integer from public.rsvp_answers
    where rsvp_id = '55555555-5555-5555-5555-555555555505' and value_text is not null),
  3,
  'an event 29 days past grace is not yet due for redaction'
);

-- The values that must be gone, read one by one. "The sweep returned 12" is not
-- evidence that the allergy note was erased.
select is(
  (select count(*)::integer from public.rsvp_answers
    where rsvp_id = '55555555-5555-5555-5555-555555555502'
      and pii_class <> 'none'
      and (value_text is not null or value_choice is not null or value_number is not null)),
  0,
  'every answer holding personal information on a redacted reply is empty'
);

select is(
  (select value_text from public.rsvp_answers
    where rsvp_id = '55555555-5555-5555-5555-555555555502' and question_prompt = 'Your name'),
  null,
  'the redacted guest name is gone'
);
select is(
  (select value_text from public.rsvp_answers
    where rsvp_id = '55555555-5555-5555-5555-555555555502' and question_prompt = 'Email'),
  null,
  'the redacted guest email is gone'
);
select is(
  (select value_text from public.rsvp_answers
    where rsvp_id = '55555555-5555-5555-5555-555555555502'
      and question_prompt = 'Anything we should know about food?'),
  null,
  'the redacted dietary note, which is health information, is gone'
);

-- The prompt stays. It is not personal information, it is the record of what
-- the guest was asked, and losing it would make the surviving counts unreadable.
select is(
  (select count(*)::integer from public.rsvp_answers
    where rsvp_id = '55555555-5555-5555-5555-555555555502' and question_prompt is not null),
  4,
  'the questions a redacted reply answered are still legible'
);

-- The values that must survive, so the buyer keeps a headcount.
select is(
  (select attendance::text || ' ' || party_size::text from public.rsvps where id = '55555555-5555-5555-5555-555555555502'),
  'attending 3',
  'attendance and party size survive redaction so the buyer keeps their headcount'
);

select is(
  (select value_choice from public.rsvp_answers
    where rsvp_id = '55555555-5555-5555-5555-555555555502' and question_prompt = 'Main course'),
  array['beef'],
  'an answer the buyer classed as holding nothing about a person survives redaction, so the caterer still has a count'
);

select is(
  (select sum(party_size)::integer from public.rsvps
    where event_id = '44444444-4444-4444-4444-444444444402' and attendance = 'attending'),
  3,
  'the headcount for a redacted event is still answerable'
);

select isnt((select pii_redacted_at from public.rsvps where id = '55555555-5555-5555-5555-555555555502'), null,
  'the redaction timestamp records when it happened');

-- Running it again must not churn rows or double-count.
select is(
  public.redact_expired_rsvp_pii(now()),
  jsonb_build_object('replies', 0, 'answers', 0),
  'redaction is idempotent'
);

-- The reply now claims to be redacted. Adding personal information behind that
-- claim would make the timestamp a statement about a moment rather than about a
-- row, so it is refused.
select throws_ok(
  $$insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_text)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444402',
            '55555555-5555-5555-5555-555555555502', '66666666-6666-6666-6666-666666666605',
            'Your name', 'short_answer', 'identity', 'Marcus Webb')$$,
  '23514',
  null,
  'personal information cannot be added to a reply that has already been redacted'
);


-- Tier 2: purge -------------------------------------------------------------

select is(public.purge_expired_events(now()), 1,
  'tier 2 deletes exactly the events more than a year past grace');

select is(
  (select count(*)::integer from public.rsvps where id = '55555555-5555-5555-5555-555555555504'),
  0,
  'purging an event takes its RSVP rows with it'
);

select is(
  (select count(*)::integer from public.rsvp_answers where rsvp_id = '55555555-5555-5555-5555-555555555504'),
  0,
  'and their answers, so the restrict on questions never keeps an orphan alive'
);

select is(
  (select count(*)::integer from public.rsvp_questions where event_id = '44444444-4444-4444-4444-444444444403'),
  0,
  'and the questions the deleted event asked'
);

select is(
  (select count(*)::integer from public.events where id = '44444444-4444-4444-4444-444444444402'),
  1,
  'an event past tier 1 but not tier 2 is redacted, not deleted'
);


-- Erasure on request --------------------------------------------------------

select ok(public.erase_rsvp('55555555-5555-5555-5555-555555555501'),
  'a guest erasure request deletes the row outright, without waiting for a sweep');

select is(
  (select count(*)::integer from public.rsvps where id = '55555555-5555-5555-5555-555555555501'),
  0,
  'the erased row is gone, not tombstoned'
);

select is(
  (select count(*)::integer from public.rsvp_answers where rsvp_id = '55555555-5555-5555-5555-555555555501'),
  0,
  'and so is everything that guest wrote'
);


-- The sweep is scheduled, and says so ---------------------------------------
-- A retention rule nobody scheduled is a paragraph in a privacy policy, not a
-- control. A scheduled one nobody records is a control nobody can audit: a
-- sweep failing since March looks exactly like a sweep with nothing to do.

select is(
  (select count(*)::integer from cron.job where jobname = 'retention-sweep'),
  1,
  'the retention sweep is scheduled'
);

select is(
  (select command from cron.job where jobname = 'retention-sweep'),
  'select public.run_retention_sweep()',
  'the scheduled job calls the sweep that runs both tiers in order'
);

select is(
  (select count(*)::integer from platform.retention_runs),
  0,
  'nothing has recorded a run yet: the calls above went to the tiers directly'
);

-- Every key, not a subset. The comparison is over the whole object minus the
-- clock, so a step added to the sweep that forgets to report itself fails here
-- rather than passing quietly.
select is(
  public.run_retention_sweep('2030-01-01T03:17:00Z'::timestamptz) - 'ran_at',
  jsonb_build_object(
    'rsvps_redacted', 1,
    'rsvp_answers_redacted', 4,
    'events_purged', 3,
    'upload_originals_discarded', 0,
    'upload_derivatives_discarded', 0,
    'objects_awaiting_deletion', 0
  ),
  'the whole sweep runs every tier and reports what each did'
);

select is(
  (select replies_redacted::text || ' ' || answers_redacted::text || ' ' || events_purged::text
     from platform.retention_runs order by ran_at desc limit 1),
  '1 4 3',
  'and records the run, so a day with no row is an alert rather than a silence'
);

select * from finish();
rollback;
