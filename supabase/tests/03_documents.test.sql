-- The template and content documents: versioning, and the content/theme split.

begin;
select * from no_plan();

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'owner@example.test');


-- Versioning ----------------------------------------------------------------

select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'no-version', 'No Version', 1,
            '{"blocks": []}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb)$$,
  '23514',
  null,
  'a template definition without a version is rejected'
);

select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'wrong-version', 'Wrong Version', 2,
            '{"version": 1, "blocks": []}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb)$$,
  '23514',
  null,
  'the version column and the version inside the document must agree'
);

-- A non-numeric version has to fail the constraint, not blow up in a cast. This
-- is why the constraint is written as CASE rather than AND.
select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'text-version', 'Text Version', 1,
            '{"version": "one", "blocks": []}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb)$$,
  '23514',
  null,
  'a non-numeric document version fails the constraint rather than raising a cast error'
);

select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'no-blocks', 'No Blocks', 1,
            '{"version": 1}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb)$$,
  '23514',
  null,
  'a template definition without a blocks array is rejected'
);


-- The content / theme split -------------------------------------------------

select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'mixed-up', 'Mixed Up', 1,
            '{"version": 1, "blocks": []}'::jsonb,
            '{"version": 1, "tokens": {}, "blocks": []}'::jsonb)$$,
  '23514',
  null,
  'content cannot be smuggled into the theme document'
);

-- Every one of these is a MISSING key rather than a wrong one. `->` on a
-- missing key returns SQL NULL, jsonb_typeof(NULL) is NULL, and a check
-- constraint that evaluates to NULL passes. The first draft of this schema had
-- exactly that hole in five constraints and these are the assertions that found
-- it, so each shape is asserted separately rather than trusting one of them to
-- stand in for the rest.

select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'no-tokens', 'No Tokens', 1,
            '{"version": 1, "blocks": []}'::jsonb, '{"version": 1}'::jsonb)$$,
  '23514',
  null,
  'a theme document without a tokens object is rejected'
);

select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'unversioned-theme', 'Unversioned Theme', 1,
            '{"version": 1, "blocks": []}'::jsonb, '{"tokens": {}}'::jsonb)$$,
  '23514',
  null,
  'a theme document without a version is rejected'
);

select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'blocks-not-array', 'Blocks Not Array', 1,
            '{"version": 1, "blocks": {}}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb)$$,
  '23514',
  null,
  'a template blocks value that is not an array is rejected'
);

select throws_ok(
  $$insert into public.templates (owner_id, key, name, definition_version, definition, theme)
    values ('11111111-1111-1111-1111-111111111111', 'tokens-not-object', 'Tokens Not Object', 1,
            '{"version": 1, "blocks": []}'::jsonb, '{"version": 1, "tokens": []}'::jsonb)$$,
  '23514',
  null,
  'a theme tokens value that is not an object is rejected'
);


-- A well-formed template, and events on it ----------------------------------

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'garden-party', 'Garden Party', 1,
  '{"version": 1, "blocks": [{"id": "hero", "type": "hero"}, {"id": "rsvp", "type": "rsvp"}]}'::jsonb,
  '{"version": 1, "tokens": {"colour": {"ink": "#1b1b1b"}, "font": {"display": "Playfair Display"}}}'::jsonb
);

insert into public.events (id, owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at)
values
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'first-event-aaa111', 'First', '2027-01-15 15:00', 'UTC', now() + interval '365 days'),
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 1, 'second-event-aaa222', 'Second', '2027-01-15 15:00', 'UTC', now() + interval '365 days');

select is(
  (select template_definition_version from public.events where id = '44444444-4444-4444-4444-444444444401'),
  1,
  'an event pins the template definition version it was activated against'
);

-- Evolving the template must not move an event that is already live.
update public.templates
   set definition_version = 2,
       definition = '{"version": 2, "blocks": [{"id": "hero", "type": "hero"}, {"id": "gallery", "type": "gallery"}, {"id": "rsvp", "type": "rsvp"}]}'::jsonb
 where id = '33333333-3333-3333-3333-333333333333';

select is(
  (select template_definition_version from public.events where id = '44444444-4444-4444-4444-444444444401'),
  1,
  'publishing a new template version leaves an already activated event pinned to the old one'
);


-- Content revisions ---------------------------------------------------------

insert into public.event_content (owner_id, event_id, revision, is_published, content_version, content)
values (
  '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401',
  1, true, 1, '{"version": 1, "blocks": {"hero": {"headline": "Sarah and Tom"}}}'::jsonb
);

insert into public.event_content (owner_id, event_id, revision, is_published, content_version, content)
values (
  '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401',
  2, false, 1, '{"version": 1, "blocks": {"hero": {"headline": "Sarah & Tom"}}}'::jsonb
);

select is(
  (select count(*)::integer from public.event_content where event_id = '44444444-4444-4444-4444-444444444401'),
  2,
  'an event keeps every revision'
);

select is(
  (select content -> 'blocks' -> 'hero' ->> 'headline' from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444401' and is_published),
  'Sarah and Tom',
  'a draft revision does not change what a guest is served'
);

select throws_ok(
  $$insert into public.event_content (owner_id, event_id, revision, is_published, content_version, content)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 3, true, 1,
            '{"version": 1, "blocks": {}}'::jsonb)$$,
  '23505',
  null,
  'an event cannot have two published revisions'
);

insert into public.event_content (owner_id, event_id, revision, is_published, content_version, content)
values (
  '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444402',
  1, true, 1, '{"version": 1, "blocks": {}}'::jsonb
);

select is(
  (select count(*)::integer from public.event_content where is_published),
  2,
  'the one-published-revision rule is per event, not global'
);

-- owner_id is denormalised, so it is taken from the event and never from the
-- caller. A caller who lies about it is corrected, not trusted.
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'stranger@example.test');

insert into public.event_content (owner_id, event_id, revision, is_published, content_version, content)
values (
  '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444402',
  2, false, 1, '{"version": 1, "blocks": {}}'::jsonb
);

select is(
  (select owner_id from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444402' and revision = 2),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'owner_id is taken from the parent event, overriding whatever the caller sent'
);

select throws_ok(
  $$insert into public.event_content (owner_id, event_id, revision, content_version, content)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 4, 1,
            '{"version": 1, "blocks": []}'::jsonb)$$,
  '23514',
  null,
  'content blocks must be an object keyed by block id, not an array'
);

select throws_ok(
  $$insert into public.event_content (owner_id, event_id, revision, content_version, content)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 5, 1,
            '{"version": 1}'::jsonb)$$,
  '23514',
  null,
  'content without a blocks key is rejected'
);

select throws_ok(
  $$insert into public.event_content (owner_id, event_id, revision, content_version, content, theme)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 6, 1,
            '{"version": 1, "blocks": {}}'::jsonb, '{"version": 1}'::jsonb)$$,
  '23514',
  null,
  'a buyer theme override without a tokens object is rejected'
);

select throws_ok(
  $$insert into public.event_content (owner_id, event_id, revision, content_version, content, theme)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 7, 1,
            '{"version": 1, "blocks": {}}'::jsonb, '{"version": 1, "tokens": {}, "blocks": {}}'::jsonb)$$,
  '23514',
  null,
  'content cannot be smuggled into a buyer theme override either'
);

select * from finish();
rollback;
