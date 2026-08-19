-- Event time and slugs: the two decisions that are permanent once a link is in
-- a group chat.

begin;
select * from no_plan();

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'owner@example.test');

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'garden-party', 'Garden Party', 1,
  '{"version": 1, "blocks": []}'::jsonb,
  '{"version": 1, "tokens": {}}'::jsonb
);


-- Time zones ----------------------------------------------------------------

select throws_ok(
  $$insert into public.events (owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1, 'bad-zone-aaa111', 'Bad Zone', '2027-01-15 15:00', 'Mars/Olympus', now() + interval '365 days')$$,
  '22023',
  null,
  'an unknown IANA time zone is rejected'
);

select throws_ok(
  $$insert into public.events (owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1, 'offset-zone-aaa222', 'Offset', '2027-01-15 15:00', '+11:00', now() + interval '365 days')$$,
  '22023',
  null,
  'a bare UTC offset is rejected: an offset is a fact about a moment, not a place'
);

-- Melbourne is UTC+11 in January (AEDT) and UTC+10 in July (AEST). Same wall
-- clock, same stored zone, different absolute instant. This is the whole reason
-- the local pair is the source of truth.
insert into public.events (
  id, owner_id, template_id, template_definition_version, slug, title,
  starts_at_local, time_zone, hosting_expires_at
)
values (
  '44444444-4444-4444-4444-444444444401',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333', 1,
  'summer-party-aaa333', 'Summer Party',
  '2027-01-15 15:00', 'Australia/Melbourne', now() + interval '365 days'
),
(
  '44444444-4444-4444-4444-444444444402',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333', 1,
  'winter-party-aaa444', 'Winter Party',
  '2027-07-15 15:00', 'Australia/Melbourne', now() + interval '365 days'
);

select is(
  (select starts_at_utc from public.events where id = '44444444-4444-4444-4444-444444444401'),
  '2027-01-15T04:00:00Z'::timestamptz,
  'a January Melbourne 3pm resolves to 04:00Z (AEDT, UTC+11)'
);

select is(
  (select starts_at_utc from public.events where id = '44444444-4444-4444-4444-444444444402'),
  '2027-07-15T05:00:00Z'::timestamptz,
  'a July Melbourne 3pm resolves to 05:00Z (AEST, UTC+10)'
);

-- starts_at_utc is a cache, so a write that tries to set it directly is ignored
-- rather than believed.
update public.events
   set starts_at_utc = '1999-01-01T00:00:00Z'
 where id = '44444444-4444-4444-4444-444444444401';

select is(
  (select starts_at_utc from public.events where id = '44444444-4444-4444-4444-444444444401'),
  '2027-01-15T04:00:00Z'::timestamptz,
  'starts_at_utc cannot be written directly: the trigger recomputes it from the local pair'
);

update public.events
   set time_zone = 'Europe/Berlin'
 where id = '44444444-4444-4444-4444-444444444401';

select is(
  (select starts_at_utc from public.events where id = '44444444-4444-4444-4444-444444444401'),
  '2027-01-15T14:00:00Z'::timestamptz,
  'moving the event to another zone recomputes the cached instant'
);


-- Hosting expiry and grace --------------------------------------------------

select is(
  (select grace_ends_at - hosting_expires_at from public.events where id = '44444444-4444-4444-4444-444444444402'),
  interval '30 days',
  'grace defaults to 30 days after hosting expiry'
);

select throws_ok(
  $$insert into public.events (owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at, grace_ends_at)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1, 'grace-before-aaa555', 'Backwards', '2027-01-15 15:00', 'UTC', now() + interval '365 days', now())$$,
  '23514',
  null,
  'grace cannot end before hosting expires'
);


-- Derived serving state -----------------------------------------------------

select is(
  public.event_state_at('draft', now() + interval '10 days', now() + interval '40 days', now()),
  'unpublished'::public.event_serving_state,
  'an unpublished event serves the unpublished state whatever the clock says'
);

select is(
  public.event_state_at('published', now() + interval '10 days', now() + interval '40 days', now()),
  'live'::public.event_serving_state,
  'inside the paid term the event is live'
);

select is(
  public.event_state_at('published', now() - interval '1 day', now() + interval '29 days', now()),
  'grace'::public.event_serving_state,
  'past hosting expiry but inside grace the link still works'
);

select is(
  public.event_state_at('published', now() - interval '40 days', now() - interval '10 days', now()),
  'expired'::public.event_serving_state,
  'past grace the event is expired'
);

-- The boundary belongs to the later state: at exactly grace_ends_at the event
-- is expired, not in grace.
select is(
  public.event_state_at('published', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z', '2027-02-01T00:00:00Z'),
  'expired'::public.event_serving_state,
  'the grace boundary is exclusive'
);


-- Slugs ---------------------------------------------------------------------

select is(public.slugify('Sarah & Tom''s Wedding!'), 'sarah-tom-s-wedding',
  'slugify strips punctuation and collapses separators');

select is(public.slugify('   '), 'event',
  'slugify falls back to a literal rather than erroring on an empty result');

select is(public.slugify('Свадьба'), 'event',
  'a title in a non-Latin script reduces to the fallback stem, not an error');

select matches(public.mint_event_slug('Sarah & Tom''s Wedding'), '^sarah-tom-s-wedding-[0-9a-f]{6}$',
  'a minted slug is the readable stem plus six hex characters');

select isnt(
  public.mint_event_slug('Same Title'),
  public.mint_event_slug('Same Title'),
  'two events with the same title get different slugs'
);

select throws_ok(
  $$insert into public.events (owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1, 'Not-A-Slug', 'Bad', '2027-01-15 15:00', 'UTC', now() + interval '365 days')$$,
  '23514',
  null,
  'a slug with uppercase characters is rejected'
);

-- Before publication the buyer can still change their mind.
update public.events set slug = 'winter-party-renamed-aaa444'
 where id = '44444444-4444-4444-4444-444444444402';

select is(
  (select slug from public.events where id = '44444444-4444-4444-4444-444444444402'),
  'winter-party-renamed-aaa444',
  'a slug can be changed before publication'
);

update public.events set status = 'published'
 where id = '44444444-4444-4444-4444-444444444402';

select throws_ok(
  $$update public.events set slug = 'too-late-aaa666' where id = '44444444-4444-4444-4444-444444444402'$$,
  '23514',
  null,
  'a slug is immutable once published, because guests already have the link'
);

select * from finish();
rollback;
