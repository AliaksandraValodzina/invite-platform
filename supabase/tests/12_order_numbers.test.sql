-- Order numbers: the list a typed Etsy order number is checked against.

begin;
select * from no_plan();

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'seller@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'buyer@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'stranger@example.test');

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'garden-party', 'Garden Party', 1,
  '{"version": 1, "blocks": []}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb
);


-- Normalisation -------------------------------------------------------------
-- Buyers retype an order number with a leading hash, with spaces, or out of an
-- email that wrapped it. All of these are the same order.

select is(
  public.hash_order_number('#3812 457901'),
  public.hash_order_number('3812457901'),
  'a hash, spaces and separators do not change the number'
);

select isnt(
  public.hash_order_number('3812457901'),
  public.hash_order_number('3812457902'),
  'a different order number hashes differently'
);

select is(
  octet_length(public.hash_order_number('3812457901')),
  32,
  'the stored hash is a 32 byte SHA-256'
);

-- The rule is written out twice, once per function, so that an order number can
-- become digits-only later without touching links buyers are already holding.
-- Asserting the agreement is what makes that drift a failing test rather than a
-- paid buyer told their order does not exist.
select is(
  public.hash_order_number('ab-12 cd'),
  public.hash_activation_code('ab-12 cd'),
  'the two normalisation rules still agree, which is the only thing keeping them apart safe'
);


-- Listing a batch ------------------------------------------------------------

insert into public.order_numbers (id, owner_id, template_id, number_hash, number_suffix)
values (
  '77777777-7777-7777-7777-777777777701',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  public.hash_order_number('3812457901'),
  '7901'
);

select is(
  (select number_suffix from public.order_numbers
    where number_hash = public.hash_order_number('#3812-457901')),
  '7901',
  'a number typed back in any format finds its row by hash'
);

select is_empty($$
  select a.attname::text
    from pg_attribute a
   where a.attrelid = 'public.order_numbers'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname in ('order_number', 'number', 'number_plaintext')
$$, 'there is no column holding an order number in plaintext');

-- The whole of "a number is single use" on the loading side. Re-loading a batch
-- is expected: the captain should be able to hand the whole Etsy export over
-- every week rather than remember where they got to.
select throws_ok(
  $$insert into public.order_numbers (owner_id, template_id, number_hash, number_suffix)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
            public.hash_order_number('3812457901'), '7901')$$,
  '23505',
  null,
  'the same order number cannot be listed twice'
);

select throws_ok(
  $$insert into public.order_numbers (owner_id, template_id, number_hash, number_suffix)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
            '\x00'::bytea, 'ZZZZ')$$,
  '23514',
  null,
  'a number_hash that is not a SHA-256 is rejected'
);

select throws_ok(
  $$insert into public.order_numbers (owner_id, template_id, number_hash, number_suffix)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
            public.hash_order_number('3812457999'), 'ab')$$,
  '23514',
  null,
  'the suffix kept in the clear is four uppercase characters or nothing'
);


-- Redemption is all or nothing ---------------------------------------------

select throws_ok(
  $$update public.order_numbers set status = 'redeemed'
     where id = '77777777-7777-7777-7777-777777777701'$$,
  '23514',
  null,
  'a number cannot be marked redeemed without a redeemer, a timestamp and an event'
);

insert into public.events (id, owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at)
values (
  '44444444-4444-4444-4444-444444444401',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333', 1,
  'ordered-event-aaa111', 'Ordered Event',
  '2027-01-15 15:00', 'Australia/Melbourne', now() + interval '365 days'
);

update public.order_numbers
   set status = 'redeemed',
       redeemed_by = '22222222-2222-2222-2222-222222222222',
       redeemed_at = now(),
       redeemed_event_id = '44444444-4444-4444-4444-444444444401'
 where id = '77777777-7777-7777-7777-777777777701';

select is(
  (select redeemed_by from public.order_numbers where id = '77777777-7777-7777-7777-777777777701'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'a redeemed number records who redeemed it, which is how the captain answers a buyer'
);

select isnt(
  (select owner_id from public.order_numbers where id = '77777777-7777-7777-7777-777777777701'),
  (select redeemed_by from public.order_numbers where id = '77777777-7777-7777-7777-777777777701'),
  'the seller and the buyer are different people, and owner_id is the seller'
);


-- Who can see the list -------------------------------------------------------
-- A buyer who redeemed a number is not the seller, so no policy shows them the
-- row. That is what stops a signed-in visitor reading which numbers have not
-- been claimed yet, which would be a list of purchases to help themselves to.

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.order_numbers),
  0,
  'the buyer who redeemed a number still cannot read the order numbers table'
);

reset role;
reset request.jwt.claims;

set local role authenticated;
set local request.jwt.claims = '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.order_numbers),
  0,
  'a signed-in stranger sees no order numbers at all'
);

reset role;
reset request.jwt.claims;


-- Guessing -------------------------------------------------------------------
-- The one thing this design has that a claim link does not: ten digits is not a
-- hundred bits. The cap lives in the database because a check in front of a
-- write can be raced or skipped by a route that forgot it.
--
-- MISSES are counted, not attempts. Enumeration is made of misses, and counting
-- every attempt would spend a shared address budget on the buyers this exists
-- to protect: a venue, an office and a mobile carrier all put many people
-- behind one address.

select is(
  public.order_number_misses('203.0.113.7'),
  0,
  'a client that has missed nothing counts as nothing'
);

select is(
  public.note_order_number_miss('203.0.113.7'),
  1,
  'the first miss from a client counts as one'
);

select is(
  public.note_order_number_miss('203.0.113.7'),
  2,
  'a second miss from the same client counts as two'
);

select is(
  public.order_number_misses('203.0.113.7'),
  2,
  'and reading the count back agrees with what recording returned'
);

select is(
  public.order_number_misses('203.0.113.8'),
  0,
  'another client is counted separately, so one guesser cannot lock everybody out'
);

select is_empty($$
  select a.attname::text
    from pg_attribute a
   where a.attrelid = 'platform.order_number_misses'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname in ('client', 'ip', 'address')
$$, 'no client address is stored, only a hash of one');

-- The window is the whole of the retention. There is no scheduled sweep over
-- this table, deliberately: it is only ever read by those two functions, so a
-- sweep that silently stopped would leave a growing log of who typed what.
update platform.order_number_misses set at = now() - interval '2 hours';

select is(
  public.order_number_misses('203.0.113.7'),
  0,
  'misses older than the window are not counted'
);

select is(
  public.note_order_number_miss('203.0.113.7'),
  1,
  'so the next miss starts again from one'
);

select is(
  (select count(*)::integer from platform.order_number_misses
    where at < now() - interval '1 hour'),
  0,
  'and the old rows are deleted rather than kept, which is this table entire retention'
);

select * from finish();
rollback;
