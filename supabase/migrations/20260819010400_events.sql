-- events: an activated instance of a template.
--
-- Three decisions here are the expensive ones. Each is explained where it lives
-- and again in docs/data-model.md.
--
-- Time. An event is a wall-clock promise ("Saturday at 3pm in Melbourne"), not
-- an instant. If we stored only a timestamptz and a government moved a DST
-- boundary between activation and the wedding, every countdown would silently
-- shift by an hour. So (starts_at_local, time_zone) is the source of truth and
-- starts_at_utc is a derived cache maintained by a trigger, kept only because
-- sorting and range queries need an absolute instant. Postgres will not accept
-- `AT TIME ZONE` in a generated column, because the result depends on the tz
-- database rather than on the row, which is exactly the reason it is a cache.
--
-- Slug. Public URL, permanent in practice the moment it lands in a group chat.
-- Minted from the title plus a random suffix, and immutable once published.
--
-- Expiry. Two explicit timestamps rather than a status column, because a status
-- column is wrong for every row between the moment it expires and the moment a
-- job notices.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null references public.templates (id) on delete restrict,
  template_definition_version integer not null,

  slug text not null,
  title text not null,
  status public.event_status not null default 'draft',
  tier public.event_tier not null default 'basic',

  starts_at_local timestamp not null,
  ends_at_local timestamp,
  time_zone text not null,
  starts_at_utc timestamptz not null,

  hosting_expires_at timestamptz not null,
  grace_ends_at timestamptz not null,

  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 3 and 64),
  constraint events_title_length
    check (char_length(title) between 1 and 160),
  constraint events_template_definition_version_positive
    check (template_definition_version >= 1),
  constraint events_ends_after_starts
    check (ends_at_local is null or ends_at_local >= starts_at_local),
  constraint events_grace_after_hosting_expiry
    check (grace_ends_at >= hosting_expires_at),
  -- A published row always knows when it was first published. The trigger fills
  -- this in; the constraint is what makes that guarantee readable from the schema.
  constraint events_published_has_timestamp
    check (status <> 'published' or published_at is not null)
);

create unique index events_slug_key on public.events (slug);
create index events_owner_id_idx on public.events (owner_id);
create index events_template_id_idx on public.events (template_id);
-- Retention sweeps and the "what is about to lapse" email both scan this.
create index events_grace_ends_at_idx on public.events (grace_ends_at);
create index events_starts_at_utc_idx on public.events (starts_at_utc);

comment on table public.events is
  'One purchased invitation. Served to guests at /e/<slug> through an API route with the service role.';
comment on column public.events.starts_at_local is
  'Wall-clock local time of the event. Source of truth for the countdown, paired with time_zone.';
comment on column public.events.time_zone is
  'IANA name, validated against pg_timezone_names by trigger. Not an offset: offsets do not survive DST.';
comment on column public.events.starts_at_utc is
  'Derived cache of starts_at_local AT TIME ZONE time_zone, recomputed on every write. Never write it directly; index and sort on it, but resolve the countdown from the local pair.';
comment on column public.events.hosting_expires_at is
  'End of the paid hosting term. The page still serves until grace_ends_at.';
comment on column public.events.grace_ends_at is
  'End of grace. After this the slug serves the designed expiry page, and the RSVP retention clock starts.';
comment on column public.events.template_definition_version is
  'The template definition version this event was activated against, pinned so that evolving a block does not change a page already shared into a chat.';


-- Default grace period. Long enough that a lapse discovered the week after the
-- wedding is still recoverable, short enough that guest PII is not held for a
-- year by accident.
create or replace function public.events_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.time_zone
  ) then
    raise exception 'unknown IANA time zone: %', new.time_zone
      using errcode = '22023';
  end if;

  new.starts_at_utc := new.starts_at_local at time zone new.time_zone;

  if new.grace_ends_at is null then
    new.grace_ends_at := new.hosting_expires_at + interval '30 days';
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  if tg_op = 'UPDATE' then
    -- The slug is the link guests already have. Renaming it after publication
    -- breaks every share that has gone out, and there is no way to reach those
    -- people to correct it.
    if new.slug is distinct from old.slug and old.published_at is not null then
      raise exception 'slug is immutable once an event has been published (event %)', old.id
        using errcode = '23514';
    end if;
    -- published_at records the first publication, not the most recent one.
    if old.published_at is not null then
      new.published_at := old.published_at;
    end if;
  end if;

  return new;
end;
$$;

-- grace_ends_at is NOT NULL and the trigger defaults it. That works because
-- Postgres checks constraints on the row a BEFORE trigger returns, not on the
-- row the caller sent.
create trigger events_before_write
  before insert or update on public.events
  for each row execute function public.events_before_write();

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();


-- Slug minting -------------------------------------------------------------
--
-- Readable stem from the title plus six hex characters. The suffix is not a
-- secret (the page is public by design) but it does three useful things: it
-- removes the collision retry loop from the common case, it stops /e/ from
-- being enumerable by guessing couples' names, and it means two "sarah-and-tom"
-- weddings can both have a nice URL.
--
-- SECURITY DEFINER so the uniqueness check sees every row. Called as a normal
-- user under RLS it would only see its own events, happily mint a slug another
-- owner already holds, and fail on insert. The only thing this leaks is whether
-- a public URL is taken, which anyone can learn by opening it.
create or replace function public.mint_event_slug(p_title text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text := null;
begin
  v_base := public.slugify(p_title);

  for _attempt in 1..10 loop
    v_slug := v_base || '-' || left(replace(gen_random_uuid()::text, '-', ''), 6);
    exit when not exists (select 1 from public.events e where e.slug = v_slug);
    v_slug := null;
  end loop;

  if v_slug is null then
    raise exception 'could not mint a unique slug for %', p_title
      using errcode = '23505';
  end if;

  return v_slug;
end;
$$;

revoke execute on function public.mint_event_slug(text) from public;
grant execute on function public.mint_event_slug(text) to authenticated, service_role;

comment on function public.mint_event_slug(text) is
  'Mints a unique, permanent-in-practice slug: slugified title plus six hex characters.';


-- Row level security -------------------------------------------------------

alter table public.events enable row level security;
alter table public.events force row level security;

revoke all on table public.events from public, anon;
grant select, insert, update, delete on table public.events to authenticated;
grant all on table public.events to service_role;

create policy "events: anon has no access"
  on public.events as restrictive to anon
  using (false) with check (false);

create policy "events: owner full access"
  on public.events for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Guest pages read this table through an API route with the service role. There
-- is no policy that would let an unauthenticated client read a published event
-- directly, on purpose: the API route is where expiry, grace and unpublished
-- states get their designed responses instead of an empty result set.
