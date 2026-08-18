-- activation_codes: the bridge from an Etsy order to a live event.
--
-- The redemption flow is Phase 1. The schema is here now because a redeemable
-- token is a thing you want to have stored correctly from the first row, not
-- migrated once ten thousand of them are in customers' hands.
--
-- Codes are stored as a SHA-256 hash, never in plaintext. A code is a bearer
-- token: whoever has the string can claim a paid activation. A database dump or
-- a stray backup should not hand someone a stack of free invitations. The
-- plaintext exists only in the moment the issuing script prints it and in the
-- buyer's Etsy delivery message. code_prefix keeps support workable: a buyer
-- reading out "ABCD..." can still be found.

create table public.activation_codes (
  id uuid primary key default gen_random_uuid(),
  -- The issuer. The platform today, a seller later. Not the redeemer.
  owner_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null references public.templates (id) on delete restrict,
  tier public.event_tier not null default 'basic',

  code_hash bytea not null,
  code_prefix text not null,

  status public.activation_code_status not null default 'issued',
  order_reference text,

  hosting_months integer not null default 12,

  issued_at timestamptz not null default now(),
  expires_at timestamptz,

  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  redeemed_event_id uuid references public.events (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint activation_codes_hash_is_sha256
    check (octet_length(code_hash) = 32),
  constraint activation_codes_prefix_format
    check (code_prefix ~ '^[A-Z0-9]{4}$'),
  constraint activation_codes_hosting_months_range
    check (hosting_months between 1 and 120),
  constraint activation_codes_order_reference_length
    check (order_reference is null or char_length(order_reference) between 1 and 120),
  -- Redemption is all-or-nothing. A row claiming to be redeemed with no
  -- redeemer, or a redeemer on an unredeemed row, is a bug we would rather see
  -- as a constraint violation than as a support ticket.
  constraint activation_codes_redemption_is_complete
    check (case
      when status = 'redeemed'
        then redeemed_by is not null and redeemed_at is not null and redeemed_event_id is not null
      else
        redeemed_by is null and redeemed_at is null and redeemed_event_id is null
    end)
);

create unique index activation_codes_code_hash_key on public.activation_codes (code_hash);
create index activation_codes_owner_id_idx on public.activation_codes (owner_id);
create index activation_codes_redeemed_by_idx on public.activation_codes (redeemed_by);
create index activation_codes_code_prefix_idx on public.activation_codes (code_prefix);

comment on table public.activation_codes is
  'Etsy delivers the plaintext code, the buyer redeems it, one event is created. Phase 1 flow, Phase 0 schema.';
comment on column public.activation_codes.code_hash is
  'SHA-256 of the normalised code. Plaintext is never stored: a code is a bearer token for a paid activation.';
comment on column public.activation_codes.code_prefix is
  'First four characters, kept in the clear so support can find a code a buyer is reading out. Four characters is not enough to guess the rest.';
comment on column public.activation_codes.hosting_months is
  'Hosting term granted at redemption, used to compute events.hosting_expires_at. Lives on the code so a promotion can vary it without a schema change.';
comment on column public.activation_codes.order_reference is
  'Etsy order id, for reconciliation and refunds. Buyer data, not guest data, and retained for the accounting period rather than the RSVP retention period.';

create trigger activation_codes_set_updated_at
  before update on public.activation_codes
  for each row execute function public.set_updated_at();


-- Normalisation is part of the format: buyers retype codes with the dashes in
-- the wrong place and in whatever case their keyboard felt like. Hash the
-- normalised form so "abcd-1234" and "ABCD1234" are the same code.
create or replace function public.hash_activation_code(p_code text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g')), 'UTF8'));
$$;

revoke execute on function public.hash_activation_code(text) from public;
grant execute on function public.hash_activation_code(text) to service_role;

comment on function public.hash_activation_code(text) is
  'Normalises a typed code (strip separators, uppercase) and returns its SHA-256. Redemption looks up activation_codes.code_hash by this value.';


-- Row level security -------------------------------------------------------

alter table public.activation_codes enable row level security;
alter table public.activation_codes force row level security;

revoke all on table public.activation_codes from public, anon;
-- The issuer manages their own codes. No DELETE: a code that turned out to be
-- fraudulent gets status 'revoked', because deleting it loses the audit trail
-- for an order someone paid money for.
grant select, insert, update on table public.activation_codes to authenticated;
grant all on table public.activation_codes to service_role;

create policy "activation_codes: anon has no access"
  on public.activation_codes as restrictive to anon
  using (false) with check (false);

create policy "activation_codes: issuer reads own"
  on public.activation_codes for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "activation_codes: issuer inserts own"
  on public.activation_codes for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "activation_codes: issuer updates own"
  on public.activation_codes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Redemption itself is a service-role operation in an API route. A buyer
-- redeeming a code is not the code's owner and has no policy that would let
-- them see it, which is what stops "select * from activation_codes" from being
-- a way to collect other people's unredeemed codes.
