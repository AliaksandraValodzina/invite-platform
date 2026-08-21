-- Uploads: the limits, the tenancy, and the deletion queue that the plan warns
-- is the kind of work that gets silently skipped.
--
-- Every assertion here is written as an attempt to break a rule, because a test
-- that only walks the happy path passes against a table whose trigger has been
-- dropped. The three that matter most, in order:
--
--   1. The per event caps are enforced by the database, not by a route. A route
--      check can be raced by two uploads in flight and forgotten by the next
--      route that writes here.
--   2. Deleting an event queues its object keys. Without that the bytes outlive
--      every row that knew about them, and nothing anywhere would ever notice.
--   3. A key two events share is NOT claimed for deletion while either of them
--      is live. Keys are content addressed, so this is not a corner case: it is
--      what happens the moment two buyers upload the same stock photograph.

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
values
  (
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333', 1,
    'uploads-one-abc123', 'Uploads One', 'published',
    '2027-01-15 15:00', 'Australia/Melbourne', now() + interval '365 days', now()
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333', 1,
    'uploads-two-abc123', 'Uploads Two', 'published',
    '2027-02-15 15:00', 'Australia/Melbourne', now() + interval '365 days', now()
  );


-- A helper so a test row is one line rather than nine.
create or replace function pg_temp.add_upload(
  p_event uuid,
  p_kind public.upload_kind,
  p_address text,
  p_variant_bytes bigint default 1000,
  p_bytes bigint default 500000
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.uploads (owner_id, event_id, kind, bytes, content_type, sha256, original_key, variants, variant_bytes)
  values (
    '11111111-1111-1111-1111-111111111111',
    p_event,
    p_kind,
    p_bytes,
    'image/jpeg',
    digest(p_address, 'sha256'),
    p_address || '-orig.jpg',
    jsonb_build_array(jsonb_build_object(
      'label', 'w960',
      'key', p_address || '-w960.webp',
      'content_type', 'image/webp',
      'bytes', p_variant_bytes,
      'width', 960,
      'height', 640
    )),
    p_variant_bytes
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- The caps, as numbers rather than as a promise -------------------------------

select is(public.upload_kind_cap('image'), 30, 'an event may hold 30 photos');
select is(public.upload_kind_cap('audio'), 1, 'an event may hold one music file');
select is(public.upload_kind_cap('envelope'), 1, 'an event may hold one envelope image');
select is(public.upload_max_bytes(), 10000000::bigint, 'ten megabytes is accepted per file');

select is(
  (select count(*)::integer from unnest(enum_range(null::public.upload_kind)) as k
    where public.upload_kind_cap(k) is null),
  0,
  'every kind that exists has a cap, so a fourth kind cannot be added without deciding one'
);


-- The caps, enforced ---------------------------------------------------------

select lives_ok(
  $$select pg_temp.add_upload('44444444-4444-4444-4444-444444444444', 'audio', 'aaaaaaaaaaaaaaaaaaaaaaaa')$$,
  'the first music file is accepted'
);

select throws_ok(
  $$select pg_temp.add_upload('44444444-4444-4444-4444-444444444444', 'audio', 'bbbbbbbbbbbbbbbbbbbbbbbb')$$,
  'UP409',
  null,
  'a second music file on the same event is refused by the database, not by a route'
);

select lives_ok(
  $$select pg_temp.add_upload('55555555-5555-5555-5555-555555555555', 'audio', 'cccccccccccccccccccccccc')$$,
  'the cap is per event, so another event may still have one'
);

-- The trigger gets there first, because a BEFORE trigger runs ahead of the
-- table's own constraints. Both exist on purpose: the trigger is what produces
-- a code the route can turn into a sentence, and the check constraint is what
-- still holds if somebody drops the trigger.
select throws_ok(
  $$insert into public.uploads (owner_id, event_id, kind, bytes, content_type, sha256, original_key, variants, variant_bytes)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'image',
            10000001, 'image/jpeg', digest('too big', 'sha256'), 'dddddddddddddddddddddddd-orig.jpg',
            '[{"label":"w960","key":"dddddddddddddddddddddddd-w960.webp","content_type":"image/webp","bytes":1000,"width":960,"height":640}]'::jsonb, 1000)$$,
  'UP413',
  null,
  'a file over ten megabytes is refused'
);

select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.uploads'::regclass
       and conname = 'uploads_bytes_within_limit'
  ),
  'and the same limit is a check constraint as well, so dropping the trigger does not silently raise it'
);

select throws_ok(
  $$select pg_temp.add_upload('44444444-4444-4444-4444-444444444444', 'image', 'eeeeeeeeeeeeeeeeeeeeeeee', 60000000)$$,
  'UP507',
  null,
  'an upload that would put the event over its stored byte budget is refused'
);


-- Dedupe ---------------------------------------------------------------------
-- Content addressing means the same file twice is one object. The row follows.

select lives_ok(
  $$select pg_temp.add_upload('44444444-4444-4444-4444-444444444444', 'image', 'ffffffffffffffffffffffff')$$,
  'a photo is stored'
);

select throws_ok(
  $$select pg_temp.add_upload('44444444-4444-4444-4444-444444444444', 'image', 'ffffffffffffffffffffffff')$$,
  '23505',
  null,
  'the same bytes uploaded twice for the same use are refused as a duplicate rather than stored twice'
);


-- Tenancy --------------------------------------------------------------------

set local role anon;

select throws_ok(
  'select * from public.uploads',
  '42501',
  null,
  'anon cannot read the uploads table'
);

select throws_ok(
  'select * from platform.upload_objects',
  '42501',
  null,
  'anon cannot read the object deletion queue'
);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.uploads),
  0,
  'a signed-in stranger sees none of somebody else uploads'
);

select throws_ok(
  'select * from platform.upload_objects',
  '42501',
  null,
  'a signed-in buyer cannot read the object deletion queue either: it is platform bookkeeping'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.uploads where event_id = '44444444-4444-4444-4444-444444444444'),
  2,
  'the owner sees their own uploads, and only the ones that were actually accepted'
);

reset role;
reset request.jwt.claims;


-- The deletion queue ---------------------------------------------------------

-- Nothing is queued while everything is live.
select is(
  (select count(*)::integer from public.claim_upload_objects(100)),
  0,
  'nothing is claimed for deletion while every upload is live'
);

-- A takedown on one asset.
select ok(
  public.disable_upload(
    (select id from public.uploads where original_key = 'ffffffffffffffffffffffff-orig.jpg'),
    'a complaint'
  ),
  'disabling an asset reports that it did something'
);

select is(
  (select count(*)::integer from public.uploads
    where event_id = '44444444-4444-4444-4444-444444444444' and deleted_at is null),
  1,
  'the takedown removed one asset and left the rest of the event alone'
);

select set_eq(
  $$select * from public.claim_upload_objects(100)$$,
  array['ffffffffffffffffffffffff-orig.jpg', 'ffffffffffffffffffffffff-w960.webp'],
  'both of the disabled asset objects are claimed for removal, and nothing else is'
);


-- The shared key, which is the assertion this whole design turns on -----------
--
-- Two events upload the same file. Content addressing gives them one object. A
-- takedown on one of them must not blank the other.

select pg_temp.add_upload('44444444-4444-4444-4444-444444444444', 'envelope', '999999999999999999999999');
select pg_temp.add_upload('55555555-5555-5555-5555-555555555555', 'envelope', '999999999999999999999999');

select ok(
  public.disable_upload(
    (select id from public.uploads
      where event_id = '44444444-4444-4444-4444-444444444444'
        and original_key = '999999999999999999999999-orig.jpg'),
    'a complaint about one of them'
  ),
  'one of the two shared assets is taken down'
);

select is(
  (select count(*)::integer from public.claim_upload_objects(100)
    where claim_upload_objects like '999999999999999999999999%'),
  0,
  'the shared object is queued but NOT claimed, because the other event is still using it'
);

-- And once the other one goes too, the bytes may finally be removed.
select ok(
  public.disable_upload(
    (select id from public.uploads
      where event_id = '55555555-5555-5555-5555-555555555555'
        and original_key = '999999999999999999999999-orig.jpg'),
    'the other one as well'
  ),
  'the second of the two shared assets is taken down'
);

select is(
  (select count(*)::integer from public.claim_upload_objects(100)
    where claim_upload_objects like '999999999999999999999999%'),
  2,
  'with nothing live referencing it, the shared object is claimed'
);


-- Retention ------------------------------------------------------------------

-- Originals go 30 days after publication; derivatives keep serving.
select is(
  public.discard_expired_upload_originals(now()),
  0,
  'a freshly published event keeps its originals'
);

select is(
  public.discard_expired_upload_originals(now() + interval '31 days'),
  2,
  'thirty days after publication the originals of the live uploads are discarded'
);

select is(
  (select count(*)::integer from public.uploads
    where deleted_at is null and original_key is not null),
  0,
  'no live upload still has an original key'
);

select is(
  (select count(*)::integer from public.uploads
    where deleted_at is null and jsonb_array_length(variants) = 0),
  0,
  'and every one of them still has its derivatives, which are what a guest is served'
);

-- Derivatives go when the page stops serving for good.
select is(
  public.discard_expired_upload_derivatives(now()),
  0,
  'an event inside its hosting term keeps its derivatives'
);

select ok(
  public.discard_expired_upload_derivatives(now() + interval '500 days') > 0,
  'once grace has ended the derivatives are discarded too'
);

select is(
  (select count(*)::integer from public.uploads where deleted_at is null),
  0,
  'nothing is left live'
);


-- The cascade, which is why the queue exists ---------------------------------
--
-- purge_expired_events deletes the event and everything under it goes with it.
-- Without the queue the bytes would survive with nothing left pointing at them.

select ok(
  (select count(*)::integer from platform.upload_objects) > 0,
  'the queue holds keys'
);

delete from public.events where id = '44444444-4444-4444-4444-444444444444';

select is(
  (select count(*)::integer from public.uploads where event_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'deleting the event cascades to its uploads'
);

select ok(
  (select count(*)::integer from platform.upload_objects
    where key like 'aaaaaaaaaaaaaaaaaaaaaaaa%') > 0,
  'and the keys those rows held are still in the queue, so the bytes can still be found and removed'
);


-- Marking done ---------------------------------------------------------------

select ok(
  public.mark_upload_object_deleted('aaaaaaaaaaaaaaaaaaaaaaaa-w960.webp'),
  'a key can be marked deleted once its bytes are gone'
);

select ok(
  not public.mark_upload_object_deleted('aaaaaaaaaaaaaaaaaaaaaaaa-w960.webp'),
  'marking it twice reports that there was nothing left to do, so a re-run is not a lie'
);

select is(
  (select count(*)::integer from public.claim_upload_objects(100)
    where claim_upload_objects = 'aaaaaaaaaaaaaaaaaaaaaaaa-w960.webp'),
  0,
  'and it is not claimed again'
);


-- The sweep reports all of it ------------------------------------------------

select ok(
  public.run_retention_sweep(now()) ? 'upload_originals_discarded',
  'the daily sweep reports what it did to originals'
);

select ok(
  public.run_retention_sweep(now()) ? 'upload_derivatives_discarded',
  'and to derivatives'
);

select ok(
  (public.run_retention_sweep(now()) ->> 'objects_awaiting_deletion')::integer > 0,
  'and says how many objects are still waiting on the half of this that Postgres cannot do'
);

select * from finish();
rollback;
