-- Enum types and the trigger helpers shared by every table.
--
-- Two conventions worth stating once, because they repeat throughout:
--
-- 1. States that are a function of the clock are NOT stored. Hosting expiry,
--    grace and code expiry are all derived from timestamps at read time. A
--    stored status column would be wrong for every row between the moment it
--    expires and the moment a sweep job notices.
-- 2. Every enum here can grow with `alter type ... add value`. That is a cheap
--    migration. Removing a value is not, so the starting sets are deliberately
--    small.

create type public.account_role as enum ('buyer', 'seller', 'admin');

comment on type public.account_role is
  'Buyers now, sellers later. The value exists from the first migration so that adding seller accounts is a policy change and not a schema change.';

create type public.template_status as enum ('draft', 'published', 'retired');

-- Publication state a buyer controls. Whether the page actually serves also
-- depends on the clock: see public.event_state_at.
create type public.event_status as enum ('draft', 'published', 'unpublished', 'archived');

create type public.event_tier as enum ('basic', 'premium');

comment on type public.event_tier is
  'Which Etsy listing the event came from. Drives hosting duration and, later, feature gates.';

-- What a guest request should be served. Derived, never stored.
create type public.event_serving_state as enum ('unpublished', 'live', 'grace', 'expired');

create type public.rsvp_attendance as enum ('attending', 'not_attending');

-- 'expired' is deliberately absent: a code past expires_at is derived, not a
-- stored state, for the same reason event expiry is.
create type public.activation_code_status as enum ('issued', 'redeemed', 'revoked');


-- Keeps updated_at honest regardless of what the caller sends.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- The one place that decides what a guest request gets. Pure function of the
-- stored row plus the clock, so it can be called from an API route, a test, or
-- a report and give the same answer.
--
-- live    hosting is paid up: full page, RSVPs open
-- grace   hosting lapsed: page still serves so a link already shared into a
--         chat does not break mid-event, RSVPs closed
-- expired designed expiry page, no event content
create or replace function public.event_state_at(
  p_status public.event_status,
  p_hosting_expires_at timestamptz,
  p_grace_ends_at timestamptz,
  p_at timestamptz default now()
)
returns public.event_serving_state
language sql
immutable
set search_path = ''
as $$
  select (case
    when p_status <> 'published' then 'unpublished'
    when p_at < p_hosting_expires_at then 'live'
    when p_at < p_grace_ends_at then 'grace'
    else 'expired'
  end)::public.event_serving_state;
$$;

revoke execute on function public.event_state_at(public.event_status, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.event_state_at(public.event_status, timestamptz, timestamptz, timestamptz) to authenticated, service_role;


-- Lowercase ASCII slug body. Anything outside [a-z0-9] collapses to a single
-- hyphen, so a title in a non-Latin script can reduce to nothing. That is why
-- the caller always appends a random suffix and why the fallback is 'event'
-- rather than an error: a buyer must never be blocked from publishing because
-- of how their language transliterates.
create or replace function public.slugify(p_input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from
        left(
          regexp_replace(lower(coalesce(p_input, '')), '[^a-z0-9]+', '-', 'g'),
          48
        )
      ),
      ''
    ),
    'event'
  );
$$;

revoke execute on function public.slugify(text) from public;
grant execute on function public.slugify(text) to authenticated, service_role;
