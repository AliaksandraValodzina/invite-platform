-- order_numbers: the list a typed Etsy order number is checked against.
--
-- The captain's decision, taken twice and recorded in firstmate's own home:
-- one public link, and the buyer types the order number from their Etsy
-- receipt. Checking that number against Etsy live needs Open API v3 approval,
-- which this shop does not have, so the site checks it against a list the
-- captain loads from their own dashboard in batches. The buyer stays
-- self-serve, the captain works in minutes a week, and a number that is not on
-- the list is refused rather than trusted.
--
-- It upgrades cleanly: the day the API is approved the same rows are written by
-- something other than a hand, and nothing else in this file changes. Nothing
-- here is built for that day.
--
-- ## Why this is not a row in activation_codes
--
-- The two look alike and are not the same thing, and conflating them would cost
-- the argument that makes activation codes safe.
--
--   An activation code is a bearer token this platform MINTS: twenty characters
--   of Crockford base32, a hundred bits, guessable in exactly the way a password
--   is. Whoever holds the string is the buyer.
--
--   An order number is a fact the buyer ALREADY HAS: about ten digits, printed
--   on their receipt, mailed to them by Etsy, and enumerable by anybody with a
--   loop. Holding it is evidence of a purchase only because this list says which
--   purchases were made.
--
-- Put them in one column and 20260819010700_activation_codes.sql stops being
-- true of its own table, `/claim/<order number>` starts resolving, and the two
-- can never be given different guessing defences. They are separate tables for
-- the same reason the three activation links are separate routes.
--
-- ## Still hashed at rest
--
-- An order number on this list is what opens a paid template, so a database
-- dump must not hand somebody a stack of unclaimed purchases. The last four
-- characters stay in the clear so support can find a row a buyer is reading
-- out, exactly as activation_codes.code_prefix does at the other end of the
-- string. The captain's own reconciliation goes the other way round: they hold
-- the numbers, and scripts/list-orders.ts hashes them to ask what each one did.

create table public.order_numbers (
  id uuid primary key default gen_random_uuid(),
  -- The seller who listed the order. The platform today, a seller later. Never
  -- the buyer who redeems it, exactly as on activation_codes.
  owner_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null references public.templates (id) on delete restrict,
  tier public.event_tier not null default 'basic',

  number_hash bytea not null,
  number_suffix text not null,

  status public.activation_code_status not null default 'issued',

  hosting_months integer not null default 12,

  listed_at timestamptz not null default now(),
  expires_at timestamptz,

  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  redeemed_event_id uuid references public.events (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint order_numbers_hash_is_sha256
    check (octet_length(number_hash) = 32),
  constraint order_numbers_suffix_format
    check (number_suffix ~ '^[A-Z0-9]{4}$'),
  constraint order_numbers_hosting_months_range
    check (hosting_months between 1 and 120),
  -- Single use, all or nothing. A row claiming to be redeemed with no redeemer,
  -- or a redeemer on an unredeemed row, is a bug we would rather see as a
  -- constraint violation than as a support ticket about a missing invitation.
  constraint order_numbers_redemption_is_complete
    check (case
      when status = 'redeemed'
        then redeemed_by is not null and redeemed_at is not null and redeemed_event_id is not null
      else
        redeemed_by is null and redeemed_at is null and redeemed_event_id is null
    end)
);

-- The whole of "a number is single use" on the loading side: the same number
-- cannot be on the list twice, so two batches overlapping is a no-op rather
-- than a second free template.
create unique index order_numbers_number_hash_key on public.order_numbers (number_hash);
create index order_numbers_owner_id_idx on public.order_numbers (owner_id);
create index order_numbers_redeemed_by_idx on public.order_numbers (redeemed_by);
create index order_numbers_status_idx on public.order_numbers (status, listed_at desc);

comment on table public.order_numbers is
  'Etsy order numbers the captain has loaded from their own dashboard. A buyer types one at /order, it is checked against this list, and it opens exactly one invitation.';
comment on column public.order_numbers.number_hash is
  'SHA-256 of the normalised order number. Plaintext is never stored: a number on this list is what opens a paid template.';
comment on column public.order_numbers.number_suffix is
  'Last four characters, kept in the clear so support can find the row a buyer is reading out. Four characters is not enough to guess the rest.';
comment on column public.order_numbers.listed_at is
  'When the captain loaded this number. What scripts/list-orders.ts sorts by, so a batch can be reconciled against the Etsy export it came from.';
comment on column public.order_numbers.hosting_months is
  'Hosting term granted at redemption, used to compute events.hosting_expires_at. On the row so a promotion can vary it without a schema change.';

create trigger order_numbers_set_updated_at
  before update on public.order_numbers
  for each row execute function public.set_updated_at();


-- Normalisation is part of what a number IS: buyers retype it with a leading
-- hash, with spaces, or out of an email that wrapped it. Hash the normalised
-- form so "#3812 457901" and "3812457901" are the same order.
--
-- The rule is deliberately the same one public.hash_activation_code uses, and
-- it is written out again rather than shared. These are two different kinds of
-- string and each has to be free to change without moving the other: an order
-- number could reasonably become digits-only tomorrow, and doing that to a code
-- would break links buyers are already holding. 12_order_numbers.test.sql
-- asserts the two agree today, so drift is a failing test rather than a
-- surprise.
create or replace function public.hash_order_number(p_number text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(upper(regexp_replace(coalesce(p_number, ''), '[^a-zA-Z0-9]', '', 'g')), 'UTF8'));
$$;

revoke execute on function public.hash_order_number(text) from public;
grant execute on function public.hash_order_number(text) to service_role;

comment on function public.hash_order_number(text) is
  'Normalises a typed Etsy order number (strip separators, uppercase) and returns its SHA-256. Redemption looks up order_numbers.number_hash by this value.';


-- Row level security -------------------------------------------------------

alter table public.order_numbers enable row level security;
alter table public.order_numbers force row level security;

revoke all on table public.order_numbers from public, anon;
-- The seller manages their own list. No DELETE: a number that turned out to be
-- a refund gets status 'revoked', because deleting it loses the trail for an
-- order somebody paid money for.
grant select, insert, update on table public.order_numbers to authenticated;
grant all on table public.order_numbers to service_role;

create policy "order_numbers: anon has no access"
  on public.order_numbers as restrictive to anon
  using (false) with check (false);

create policy "order_numbers: seller reads own"
  on public.order_numbers for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "order_numbers: seller inserts own"
  on public.order_numbers for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "order_numbers: seller updates own"
  on public.order_numbers for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Redemption is a service-role operation, like an activation code's. A buyer
-- redeeming a number is not the seller and has no policy that would show them
-- the row, which is what stops a signed-in visitor reading the list of numbers
-- that have not been claimed yet.


-- Guessing --------------------------------------------------------------------
--
-- The one thing this design has that the claim link does not: a ten digit
-- number is not a hundred bits. Somebody with a loop can walk the space around
-- a real order number, and every hit is a paid buyer's invitation taken before
-- they arrive. Hashing the column does nothing about that, because the form
-- hashes whatever is typed.
--
-- So the cost of a wrong guess is bounded here, where a route cannot skip it,
-- for the same reason public.upload_kind_cap lives in the database: a check in
-- front of a write can be raced or forgotten.
--
-- MISSES are counted, not attempts. Enumeration is made of misses: an attacker
-- has to be wrong thousands of times to be right once, and a number they do
-- find is single use and worth exactly one invitation. Counting every attempt
-- instead would spend a shared address's budget on the people it is there to
-- protect, and a wedding venue, an office and a mobile carrier all put many
-- buyers behind one address.
--
-- `platform` is not in the Data API's exposed schemas, so this table has no
-- HTTP surface at all and the two functions below are its only door.

create table platform.order_number_misses (
  id bigint generated always as identity primary key,
  client_hash bytea not null,
  at timestamptz not null default now()
);

create index order_number_misses_client_idx
  on platform.order_number_misses (client_hash, at desc);

comment on table platform.order_number_misses is
  'One row per order number typed that was not on the list, kept only for the throttle window. Pruned by public.note_order_number_miss on every call, which is the whole of its retention.';

revoke all on table platform.order_number_misses from public, anon, authenticated;
grant select, insert, delete on table platform.order_number_misses to service_role;

/*
 * The client string is hashed inside these functions rather than in the app, so
 * no address is ever stored. A SHA-256 of an IPv4 address is not anonymisation
 * and is not offered as any: what limits this is that the rows live for one
 * window and are deleted by the next call. The delete is at the top of the
 * recording function rather than in a scheduled sweep because the table is only
 * ever read by these two, so a sweep that silently stopped would leave a
 * growing log of who typed what and nothing would notice.
 *
 * SECURITY DEFINER because `platform` is a schema no caller holds privilege in.
 */
create or replace function public.order_number_misses(
  p_client text,
  p_window_seconds integer default 900
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer
    from platform.order_number_misses
   where client_hash = sha256(convert_to(coalesce(p_client, ''), 'UTF8'))
     and at >= now() - make_interval(secs => greatest(p_window_seconds, 1));
$$;

create or replace function public.note_order_number_miss(
  p_client text,
  p_window_seconds integer default 900
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client bytea := sha256(convert_to(coalesce(p_client, ''), 'UTF8'));
  v_since timestamptz := now() - make_interval(secs => greatest(p_window_seconds, 1));
  v_count integer;
begin
  delete from platform.order_number_misses where at < v_since;

  insert into platform.order_number_misses (client_hash) values (v_client);

  select count(*) into v_count
    from platform.order_number_misses
   where client_hash = v_client and at >= v_since;

  return v_count;
end;
$$;

revoke execute on function public.order_number_misses(text, integer) from public;
revoke execute on function public.note_order_number_miss(text, integer) from public;
grant execute on function public.order_number_misses(text, integer) to service_role;
grant execute on function public.note_order_number_miss(text, integer) to service_role;

comment on function public.order_number_misses(text, integer) is
  'How many order numbers this client has typed and missed inside the window. Read before a lookup; the app refuses above its own cap. See src/lib/activation/order-throttle.ts.';
comment on function public.note_order_number_miss(text, integer) is
  'Records one missed order number against a hashed client address, prunes the window, and returns the running count.';
