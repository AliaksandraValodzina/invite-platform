-- RSVPs and the retention rule.
--
-- The assertions here read the values that survive and the values that are
-- gone, rather than checking that a sweep "ran". A sweep that updated a
-- timestamp and left the allergy notes in place would pass the second kind of
-- test and fail this one.

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


-- Constraints ---------------------------------------------------------------

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size, guest_name)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'not_attending', 2, 'Declining Dave')$$,
  '23514',
  null,
  'a decline cannot bring guests, so sum(party_size) is the headcount with no special case'
);

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size, guest_name, guest_email)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'attending', 1, 'Shouty', 'Shouty@Example.Test')$$,
  '23514',
  null,
  'a guest email must be stored normalised to lower case'
);

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size, guest_name, message)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'attending', 1, 'Verbose', repeat('a', 2001))$$,
  '23514',
  null,
  'free text is capped, which caps how much a stranger can store about themselves here'
);

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size, guest_name, pii_redacted_at)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'attending', 1, 'Half Redacted', now())$$,
  '23514',
  null,
  'a half-redacted row cannot exist: redacted means every identifying column is null'
);

select throws_ok(
  $$insert into public.rsvps (owner_id, event_id, attendance, party_size)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'attending', 1)$$,
  '23514',
  null,
  'an unredacted row must carry a guest name'
);


-- Fixtures ------------------------------------------------------------------

insert into public.rsvps (id, owner_id, event_id, attendance, party_size, guest_name, guest_email, dietary_notes, message)
values
  ('55555555-5555-5555-5555-555555555501', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444401', 'attending', 2, 'Priya Raman', 'priya@example.test', 'coeliac', 'Cannot wait'),
  ('55555555-5555-5555-5555-555555555502', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444402', 'attending', 3, 'Marcus Webb', 'marcus@example.test', 'severe nut allergy', 'See you there'),
  ('55555555-5555-5555-5555-555555555503', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444402', 'not_attending', 0, 'Jo Fitzgerald', 'jo@example.test', null, 'Sorry, away that week'),
  ('55555555-5555-5555-5555-555555555504', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444403', 'attending', 1, 'Old Guest', 'old@example.test', 'vegetarian', null),
  ('55555555-5555-5555-5555-555555555505', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444404', 'attending', 4, 'Recent Guest', 'recent@example.test', 'no pork', null);

-- owner_id is denormalised from the event, so a caller cannot claim someone
-- else's RSVPs by writing a different value.
select is(
  (select owner_id from public.rsvps where id = '55555555-5555-5555-5555-555555555501'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'an RSVP owner_id comes from the parent event'
);


-- Tier 1: redaction ---------------------------------------------------------

-- Two RSVPs on the event 31 days past grace, one on the event 366 days past
-- grace. The tier 2 event is redacted first and deleted second: tier 1 does not
-- skip rows just because tier 2 is about to remove them.
select is(public.redact_expired_rsvp_pii(now()), 3,
  'tier 1 redacts exactly the RSVPs whose event passed grace more than 30 days ago');

select is(
  (select guest_name || '|' || coalesce(guest_email, '') || '|' || coalesce(dietary_notes, '') || '|' || coalesce(message, '')
     from public.rsvps where id = '55555555-5555-5555-5555-555555555501'),
  'Priya Raman|priya@example.test|coeliac|Cannot wait',
  'a live event keeps every RSVP field'
);

select is(
  (select guest_name from public.rsvps where id = '55555555-5555-5555-5555-555555555505'),
  'Recent Guest',
  'an event 29 days past grace is not yet due for redaction'
);

-- The values that must be gone, read one by one. "The sweep returned 2" is not
-- evidence that the allergy note was erased.
select is((select guest_name    from public.rsvps where id = '55555555-5555-5555-5555-555555555502'), null,
  'the redacted guest name is gone');
select is((select guest_email   from public.rsvps where id = '55555555-5555-5555-5555-555555555502'), null,
  'the redacted guest email is gone');
select is((select dietary_notes from public.rsvps where id = '55555555-5555-5555-5555-555555555502'), null,
  'the redacted dietary note, which is health information, is gone');
select is((select message       from public.rsvps where id = '55555555-5555-5555-5555-555555555502'), null,
  'the redacted free-text message is gone');

-- The values that must survive, so the buyer keeps a headcount.
select is(
  (select attendance::text || ' ' || party_size::text from public.rsvps where id = '55555555-5555-5555-5555-555555555502'),
  'attending 3',
  'attendance and party size survive redaction so the buyer keeps their headcount'
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
select is(public.redact_expired_rsvp_pii(now()), 0,
  'redaction is idempotent');


-- Tier 2: purge -------------------------------------------------------------

select is(public.purge_expired_events(now()), 1,
  'tier 2 deletes exactly the events more than a year past grace');

select is(
  (select count(*)::integer from public.rsvps where id = '55555555-5555-5555-5555-555555555504'),
  0,
  'purging an event takes its RSVP rows with it'
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


-- The sweep is scheduled ----------------------------------------------------
-- A retention rule nobody scheduled is a paragraph in a privacy policy, not a
-- control. This is the assertion that catches it being dropped.

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

select * from finish();
rollback;
