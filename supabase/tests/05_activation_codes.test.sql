-- Activation codes. Phase 1 flow, Phase 0 schema.

begin;
select * from no_plan();

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'platform@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'buyer@example.test');

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'garden-party', 'Garden Party', 1,
  '{"version": 1, "blocks": []}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb
);


-- Normalisation -------------------------------------------------------------
-- Buyers retype codes with the separators in the wrong place and in whatever
-- case their keyboard felt like. All of these are the same code.

select is(
  public.hash_activation_code('abcd-1234-efgh'),
  public.hash_activation_code('ABCD1234EFGH'),
  'case and separators do not change the code'
);

select is(
  public.hash_activation_code('  abcd 1234 efgh  '),
  public.hash_activation_code('ABCD-1234-EFGH'),
  'whitespace does not change the code'
);

select isnt(
  public.hash_activation_code('ABCD1234EFGH'),
  public.hash_activation_code('ABCD1234EFGI'),
  'a different code hashes differently'
);

select is(
  octet_length(public.hash_activation_code('ABCD1234EFGH')),
  32,
  'the stored hash is a 32 byte SHA-256'
);


-- Issuing -------------------------------------------------------------------

insert into public.activation_codes (id, owner_id, template_id, code_hash, code_prefix, order_reference)
values (
  '66666666-6666-6666-6666-666666666601',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  public.hash_activation_code('ABCD-1234-EFGH'),
  'ABCD',
  'etsy-3081774592'
);

-- Redemption looks the code up by hash. Plaintext is never stored, so this is
-- the only way in.
select is(
  (select code_prefix from public.activation_codes
    where code_hash = public.hash_activation_code('abcd1234efgh')),
  'ABCD',
  'a code typed back in any format finds its row by hash'
);

select is_empty($$
  select a.attname::text
    from pg_attribute a
   where a.attrelid = 'public.activation_codes'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname in ('code', 'code_plaintext', 'secret')
$$, 'there is no column holding a code in plaintext');

select throws_ok(
  $$insert into public.activation_codes (owner_id, template_id, code_hash, code_prefix)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
            public.hash_activation_code('ABCD-1234-EFGH'), 'ABCD')$$,
  '23505',
  null,
  'the same code cannot be issued twice'
);

select throws_ok(
  $$insert into public.activation_codes (owner_id, template_id, code_hash, code_prefix)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
            '\x00'::bytea, 'ZZZZ')$$,
  '23514',
  null,
  'a code_hash that is not a SHA-256 is rejected'
);


-- Redemption is all or nothing ---------------------------------------------

select throws_ok(
  $$update public.activation_codes set status = 'redeemed'
     where id = '66666666-6666-6666-6666-666666666601'$$,
  '23514',
  null,
  'a code cannot be marked redeemed without a redeemer, a timestamp and an event'
);

insert into public.events (id, owner_id, template_id, template_definition_version, slug, title, starts_at_local, time_zone, hosting_expires_at)
values (
  '44444444-4444-4444-4444-444444444401',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333', 1,
  'redeemed-event-aaa111', 'Redeemed Event',
  '2027-01-15 15:00', 'Australia/Melbourne', now() + interval '365 days'
);

update public.activation_codes
   set status = 'redeemed',
       redeemed_by = '22222222-2222-2222-2222-222222222222',
       redeemed_at = now(),
       redeemed_event_id = '44444444-4444-4444-4444-444444444401'
 where id = '66666666-6666-6666-6666-666666666601';

select is(
  (select redeemed_by from public.activation_codes where id = '66666666-6666-6666-6666-666666666601'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'a redeemed code records who redeemed it'
);

select isnt(
  (select owner_id from public.activation_codes where id = '66666666-6666-6666-6666-666666666601'),
  (select redeemed_by from public.activation_codes where id = '66666666-6666-6666-6666-666666666601'),
  'the issuer and the redeemer are different people, and owner_id is the issuer'
);

-- The buyer who redeemed the code is not its owner, so no policy shows it to
-- them. That is what stops a signed-in buyer collecting other people's
-- unredeemed codes.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.activation_codes),
  0,
  'the buyer who redeemed a code still cannot read the codes table'
);

reset role;
reset request.jwt.claims;

select * from finish();
rollback;
