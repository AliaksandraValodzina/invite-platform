-- The extensible answer model: questions, answers, and the two rules the schema
-- is supposed to enforce rather than the application remembering.
--
-- Every assertion here is written as an attempt to break the rule, because a
-- test that only exercises the happy path passes against a table with the
-- constraint dropped. What happens to these rows over time is
-- 04_rsvps_retention.test.sql.

begin;
select * from no_plan();

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.test');

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'garden-party', 'Garden Party', 1,
  '{"version": 1, "blocks": []}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb
);

insert into public.events (id, owner_id, template_id, template_definition_version, slug, title, status, starts_at_local, time_zone, hosting_expires_at, published_at)
values (
  '44444444-4444-4444-4444-444444444444',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333', 1,
  'answer-model-abc123', 'Answer Model', 'published',
  '2027-01-15 15:00', 'Australia/Melbourne', now() + interval '365 days', now()
);


-- The shape map --------------------------------------------------------------
-- This is the function that makes a sixth question type an addition: value
-- columns are typed by shape, so a new type that maps onto one of these needs
-- an enum value and a branch rather than a column.

select is(public.rsvp_answer_shape('short_answer')::text, 'text', 'short answers store text');
select is(public.rsvp_answer_shape('long_answer')::text, 'text', 'long answers store text');
select is(public.rsvp_answer_shape('email')::text, 'text', 'emails store text');
select is(public.rsvp_answer_shape('multiple_choice')::text, 'choice', 'one-of questions store a choice');
select is(public.rsvp_answer_shape('checkbox')::text, 'choice', 'any-of questions store a choice');

select is(
  (select count(*)::integer from unnest(enum_range(null::public.rsvp_question_type)) as t
    where public.rsvp_answer_shape(t) is null),
  0,
  'every question type that exists has a storage shape, so no type can be added without saying where its answers go'
);


-- Questions ------------------------------------------------------------------

insert into public.rsvp_questions (id, owner_id, event_id, type, prompt, position, required, pii_class)
values
  ('66666666-6666-6666-6666-666666666601', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 'short_answer', 'Your name', 1, true, 'identity'),
  ('66666666-6666-6666-6666-666666666602', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 'email', 'Email', 2, false, 'contact'),
  ('66666666-6666-6666-6666-666666666603', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 'long_answer', 'Anything we should know about food?', 3, false, 'sensitive');

insert into public.rsvp_questions (id, owner_id, event_id, type, prompt, position, pii_class, options)
values (
  '66666666-6666-6666-6666-666666666604', '11111111-1111-1111-1111-111111111111',
  '44444444-4444-4444-4444-444444444444', 'checkbox', 'Which events will you be at?', 4, 'none',
  '[{"value": "ceremony", "label": "Ceremony"}, {"value": "dinner", "label": "Dinner"}]'::jsonb
);

select is(
  (select owner_id from public.rsvp_questions where id = '66666666-6666-6666-6666-666666666601'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'a question owner_id comes from the parent event, not from the caller'
);

select throws_ok(
  $$insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'multiple_choice', 'Main course', 9, 'none')$$,
  '23514',
  null,
  'a question whose answers are a choice needs an options list'
);

select throws_ok(
  $$insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class, options)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'short_answer', 'Your name again', 9, 'identity',
            '[{"value": "a", "label": "A"}, {"value": "b", "label": "B"}]'::jsonb)$$,
  '23514',
  null,
  'a question whose answers are text carries no options list'
);

select throws_ok(
  $$insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class, options)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'multiple_choice', 'Main course', 9, 'none',
            '[{"value": "fish", "label": "Fish"}, {"value": "fish", "label": "Fish again"}]'::jsonb)$$,
  '23514',
  null,
  'two options cannot share a value, because the value is what an answer stores'
);

select throws_ok(
  $$insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class, options)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'multiple_choice', 'Main course', 9, 'none',
            '["fish", "beef"]'::jsonb)$$,
  '23514',
  null,
  'an option is a value and a label, not a bare string'
);

select throws_ok(
  $$insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'short_answer', repeat('a', 201), 9, 'identity')$$,
  '23514',
  null,
  'a prompt is capped, which bounds what a buyer can ask a stranger to write about themselves'
);

select throws_ok(
  $$insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'short_answer', 'Position taken', 1, 'identity')$$,
  '23505',
  null,
  'two live questions cannot share a position'
);

-- The cap. An extensible question set with no ceiling is an unbounded personal
-- data surface, so the ceiling is in the schema and not in a form.
insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class)
select '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
       'short_answer', 'Filler ' || n, n, 'none'
  from generate_series(5, 12) as n;

select is(
  (select count(*)::integer from public.rsvp_questions
    where event_id = '44444444-4444-4444-4444-444444444444' and retired_at is null),
  12,
  'twelve live questions is allowed'
);

select throws_ok(
  $$insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'short_answer', 'One too many', 13, 'none')$$,
  '23514',
  null,
  'a thirteenth live question is refused'
);

-- Retiring one frees the ceiling and the position.
update public.rsvp_questions set retired_at = now() where prompt = 'Filler 12';

select lives_ok(
  $$insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'short_answer', 'Replacement', 12, 'none')$$,
  'retiring a question frees both its position and its place under the cap'
);


-- Answers --------------------------------------------------------------------

insert into public.rsvps (id, owner_id, event_id, attendance, party_size)
values ('55555555-5555-5555-5555-555555555501', '11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444', 'attending', 2);

insert into public.rsvp_answers (id, owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_text)
values
  ('77777777-7777-7777-7777-777777777701', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555501',
   '66666666-6666-6666-6666-666666666601', 'Your name', 'short_answer', 'identity', 'Priya Raman'),
  ('77777777-7777-7777-7777-777777777702', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555501',
   '66666666-6666-6666-6666-666666666603', 'Anything we should know about food?', 'long_answer', 'sensitive', 'coeliac');

insert into public.rsvp_answers (id, owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_choice)
values (
  '77777777-7777-7777-7777-777777777703', '11111111-1111-1111-1111-111111111111',
  '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555501',
  '66666666-6666-6666-6666-666666666604', 'Which events will you be at?', 'checkbox', 'none', '{ceremony,dinner}'
);

-- A checkbox with nothing ticked is a value, not an absence: the guest read the
-- question and chose none of it.
select lives_ok(
  $$insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_choice)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
            '55555555-5555-5555-5555-555555555501', '66666666-6666-6666-6666-666666666604',
            'Which events will you be at?', 'checkbox', 'none', '{}')$$,
  'a checkbox answer with nothing ticked is storable'
);

select throws_ok(
  $$insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_choice)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
            '55555555-5555-5555-5555-555555555501', '66666666-6666-6666-6666-666666666601',
            'Your name', 'short_answer', 'identity', '{Priya}')$$,
  '23514',
  null,
  'an answer stores into the column its type shape names, and nowhere else'
);

select throws_ok(
  $$insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_text, value_number)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
            '55555555-5555-5555-5555-555555555501', '66666666-6666-6666-6666-666666666601',
            'Your name', 'short_answer', 'identity', 'Priya', 3)$$,
  '23514',
  null,
  'an answer carries one value, so no row can mean two things'
);

select throws_ok(
  $$insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
            '55555555-5555-5555-5555-555555555501', '66666666-6666-6666-6666-666666666601',
            'Your name', 'short_answer', 'identity')$$,
  '23514',
  null,
  'an unanswered question stores no row at all rather than an empty one'
);


-- A reply is an immutable record of what was answered at the time -------------

update public.rsvp_questions
   set prompt = 'What should we call you?'
 where id = '66666666-6666-6666-6666-666666666601';

select is(
  (select question_prompt from public.rsvp_answers where id = '77777777-7777-7777-7777-777777777701'),
  'Your name',
  'rewording a question does not rewrite what the guest was actually asked'
);

select is(
  (select prompt from public.rsvp_questions where id = '66666666-6666-6666-6666-666666666601'),
  'What should we call you?',
  'and the question itself is free to change, which is the point of the snapshot'
);

select throws_ok(
  $$update public.rsvp_answers set value_text = 'Someone Else' where id = '77777777-7777-7777-7777-777777777701'$$,
  '23514',
  null,
  'an answer value cannot be changed into a different one'
);

select throws_ok(
  $$update public.rsvp_answers set question_prompt = 'A question nobody asked' where id = '77777777-7777-7777-7777-777777777701'$$,
  '23514',
  null,
  'the snapshot on an answer cannot be edited'
);

select throws_ok(
  $$update public.rsvp_answers set pii_class = 'none' where id = '77777777-7777-7777-7777-777777777702'$$,
  '23514',
  null,
  'an answer cannot be reclassified out of the reach of the retention sweep'
);


-- Retiring a question keeps the answers to it --------------------------------
-- The test that tries to lose them. A cascade here would be the one thing the
-- captain ruled out: a buyer tidying their form destroying replies people
-- already gave.

select throws_ok(
  $$delete from public.rsvp_questions where id = '66666666-6666-6666-6666-666666666601'$$,
  '23503',
  null,
  'a question with answers cannot be deleted, so the cascade is impossible rather than merely discouraged'
);

update public.rsvp_questions set retired_at = now() where id = '66666666-6666-6666-6666-666666666601';

select is(
  (select value_text from public.rsvp_answers where id = '77777777-7777-7777-7777-777777777701'),
  'Priya Raman',
  'retiring a question keeps every answer anybody gave it'
);

select is(
  (select question_prompt from public.rsvp_answers where id = '77777777-7777-7777-7777-777777777701'),
  'Your name',
  'and the retired question is still readable on the answer, so the reply still makes sense'
);

select is(
  (select count(*)::integer from public.rsvp_questions
    where id = '66666666-6666-6666-6666-666666666601' and retired_at is not null),
  1,
  'the retired question row is still there, because answers point at it'
);


-- Redaction is enforced by the database --------------------------------------
-- Each of these is an attempt to leave a row that claims to be redacted while
-- still holding what a guest wrote.

select throws_ok(
  $$update public.rsvp_answers set pii_redacted_at = now() where id = '77777777-7777-7777-7777-777777777702'$$,
  '23514',
  null,
  'a half-redacted answer cannot exist: the timestamp without the erasure is refused'
);

select throws_ok(
  $$insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_text, pii_redacted_at)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
            '55555555-5555-5555-5555-555555555501', '66666666-6666-6666-6666-666666666602',
            'Email', 'email', 'contact', 'priya@example.test', now())$$,
  '23514',
  null,
  'nor can one be written half-redacted in the first place'
);

update public.rsvp_answers
   set value_text = null, pii_redacted_at = now()
 where id = '77777777-7777-7777-7777-777777777702';

select is(
  (select value_text from public.rsvp_answers where id = '77777777-7777-7777-7777-777777777702'),
  null,
  'a complete redaction is accepted'
);

select throws_ok(
  $$update public.rsvp_answers set pii_redacted_at = null where id = '77777777-7777-7777-7777-777777777702'$$,
  '23514',
  null,
  'and cannot be undone'
);

select throws_ok(
  $$update public.rsvp_answers set value_text = 'coeliac', pii_redacted_at = null where id = '77777777-7777-7777-7777-777777777702'$$,
  '23514',
  null,
  'nor can the erased value be written back'
);


-- Privileges -----------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.rsvp_answers),
  4,
  'the buyer reads the replies to their own event'
);

select throws_ok(
  $$delete from public.rsvp_questions where id = '66666666-6666-6666-6666-666666666602'$$,
  '42501',
  null,
  'a buyer holds no DELETE on questions at all: removal is retiring, and the privilege system says so'
);

select throws_ok(
  $$insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_text)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
            '55555555-5555-5555-5555-555555555501', '66666666-6666-6666-6666-666666666602',
            'Email', 'email', 'contact', 'written-by-the-buyer@example.test')$$,
  '42501',
  null,
  'even the owner cannot write an answer: that path is an API route with the service role'
);

select throws_ok(
  $$update public.rsvp_answers set value_text = 'Edited by the buyer' where id = '77777777-7777-7777-7777-777777777701'$$,
  '42501',
  null,
  'and cannot edit what a guest wrote about their own allergies'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.rsvp_answers),
  0,
  'a signed-in stranger sees none of somebody else guests answers'
);

select is(
  (select count(*)::integer from public.rsvp_questions),
  0,
  'nor which questions they were asked'
);

reset role;
reset request.jwt.claims;

set local role anon;

select throws_ok(
  'select * from public.rsvp_answers',
  '42501',
  null,
  'anon cannot read answers'
);

select throws_ok(
  'select * from public.rsvp_questions',
  '42501',
  null,
  'anon cannot read questions'
);

reset role;

select * from finish();
rollback;
