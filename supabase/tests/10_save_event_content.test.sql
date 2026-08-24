-- Saving a buyer's content: what public.save_event_content does, and what it
-- refuses.
--
-- Three claims are made here rather than in the application, because all three
-- are properties of the transaction and the policies rather than of the code
-- that calls them.
--
--   Exactly one revision is published, at every moment. Unpublishing the old
--   one and publishing the new one are one statement in one function, so the
--   partial unique index is never seen half satisfied and an event can never be
--   left with nothing to serve.
--
--   Row level security is the ownership check. The function is SECURITY
--   INVOKER, so an event that is not yours reports that it does not exist, and
--   the application never writes a `where owner_id = ...` that somebody could
--   forget.
--
--   A palette survives a save. The theme override lives beside the content on
--   the same row, so a new revision that took the column default would put every
--   event back to its template palette on the buyer's first save.
--
--   Either half may be sent on its own. A palette save carries a theme and no
--   content, a words save carries content and no theme, and whichever half is
--   absent comes forward from the revision being replaced. Both write one whole
--   new published revision, so a guest never reads a document that is half of
--   one save and half of another.

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
  'save-content-abc123', 'Save Content', 'published',
  '2027-01-15 15:00', 'Australia/Melbourne', now() + interval '365 days', now()
);

-- The revision an activation would have written, with a palette the buyer chose.
insert into public.event_content (owner_id, event_id, revision, is_published, content_version, content, theme)
values (
  '11111111-1111-1111-1111-111111111111',
  '44444444-4444-4444-4444-444444444444',
  1, true, 2,
  '{"version": 2, "blocks": {"hero": {"headline": "Sarah & Tom"}}}'::jsonb,
  '{"version": 2, "tokens": {"color": {"accent": "#856539"}}}'::jsonb
);


-- As the owner ---------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  public.save_event_content(
    '44444444-4444-4444-4444-444444444444',
    '{"version": 2, "blocks": {"hero": {"headline": "Perpetua & Cornelius"}}}'::jsonb
  ),
  2,
  'a save writes the next revision rather than editing the live one in place'
);

select is(
  (select count(*)::integer from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444'),
  2,
  'the revision it replaced is still there, because "restore what it said last week" is a real request'
);

select is(
  (select count(*)::integer from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  1,
  'exactly one revision is published, which the partial unique index also insists on'
);

select is(
  (select content -> 'blocks' -> 'hero' ->> 'headline' from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  'Perpetua & Cornelius',
  'the published revision is the one just written'
);

select is(
  (select theme from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  '{"version": 2, "tokens": {"color": {"accent": "#856539"}}}'::jsonb,
  'the palette is carried forward, so saving words does not reset a theme override'
);

select is(
  (select owner_id from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'owner_id comes from the event through the trigger, not from what the function passed'
);

select is(
  (select content_version from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  2,
  'content_version mirrors the version inside the document, which the check constraint also insists on'
);

select throws_ok(
  $$select public.save_event_content(
      '44444444-4444-4444-4444-444444444444',
      '{"blocks": {}}'::jsonb
    )$$,
  '22023',
  'content must carry a numeric version',
  'a document with no version is refused before anything is written'
);

select is(
  (select count(*)::integer from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444'),
  2,
  'and that refusal wrote nothing'
);


-- A section list, which is composition ----------------------------------------

select is(
  public.save_event_content(
    '44444444-4444-4444-4444-444444444444',
    '{"version": 3, "blocks": {"hero": {"headline": "Perpetua & Cornelius"}}, "sections": ["rsvp", "hero"]}'::jsonb
  ),
  3,
  'a composition is part of the content document, so it saves the way words do'
);

select is(
  (select content -> 'sections' from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  '["rsvp", "hero"]'::jsonb,
  'the order a buyer composed is what the published revision carries'
);

select throws_like(
  $$insert into public.event_content
      (owner_id, event_id, revision, is_published, content_version, content)
    values ('11111111-1111-1111-1111-111111111111',
            '44444444-4444-4444-4444-444444444444', 99, false, 3,
            '{"version": 3, "blocks": {}, "sections": "hero"}'::jsonb)$$,
  '%event_content_sections_is_array%',
  'a section list that is not a list is refused by the schema, not only by the app'
);


-- A palette, saved on its own -------------------------------------------------
-- The words are not resent, so the revision this writes has to carry them
-- forward. A palette save that reset somebody words to the template defaults
-- would be the worst bug in the editor.

select is(
  public.save_event_content(
    '44444444-4444-4444-4444-444444444444',
    null,
    '{"version": 2, "tokens": {"color": {"accent": "#2f6f4f"}}}'::jsonb
  ),
  4,
  'a palette save is a new revision too, so a colour choice is as restorable as a sentence'
);

select is(
  (select theme -> 'tokens' -> 'color' ->> 'accent' from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  '#2f6f4f',
  'the palette it was sent is the published one'
);

select is(
  (select content from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  '{"version": 3, "blocks": {"hero": {"headline": "Perpetua & Cornelius"}}, "sections": ["rsvp", "hero"]}'::jsonb,
  'and the words and the composition came forward untouched, because a palette save sent none'
);

select is(
  (select content_version from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  3,
  'content_version comes forward with the document it describes'
);

select throws_ok(
  $$select public.save_event_content('44444444-4444-4444-4444-444444444444')$$,
  '22023',
  'a save must carry content, a theme, or both',
  'a save that changes nothing is a bug in the caller rather than a new revision'
);

select is(
  (select count(*)::integer from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444'),
  4,
  'and that refusal wrote nothing either'
);


-- As somebody else -----------------------------------------------------------
-- Row level security is the whole check. A stranger gets the answer somebody
-- guessing at ids should get, which is the one an event that does not exist
-- gets.

reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$select public.save_event_content(
      '44444444-4444-4444-4444-444444444444',
      '{"version": 3, "blocks": {"hero": {"headline": "Mine now"}}}'::jsonb
    )$$,
  '23503',
  'event 44444444-4444-4444-4444-444444444444 does not exist',
  'somebody else event cannot be written to, and is not admitted to exist'
);

select throws_ok(
  $$select public.save_event_content(
      '55555555-5555-5555-5555-555555555555',
      '{"version": 3, "blocks": {}}'::jsonb
    )$$,
  '23503',
  'event 55555555-5555-5555-5555-555555555555 does not exist',
  'an event that really does not exist says exactly the same thing'
);

reset request.jwt.claims;
set local role postgres;

select is(
  (select content -> 'blocks' -> 'hero' ->> 'headline' from public.event_content
    where event_id = '44444444-4444-4444-4444-444444444444' and is_published),
  'Perpetua & Cornelius',
  'and the owner content is exactly as they left it'
);


-- Nobody signed in -----------------------------------------------------------

set local role anon;

select throws_ok(
  $$select public.save_event_content(
      '44444444-4444-4444-4444-444444444444',
      '{"version": 3, "blocks": {}}'::jsonb
    )$$,
  '42501',
  null,
  'anon holds no execute privilege on it at all'
);

reset role;

select * from finish();
rollback;
