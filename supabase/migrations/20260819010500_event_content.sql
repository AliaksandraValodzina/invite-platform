-- event_content: the buyer's customisations, as revisions.
--
-- One row per saved revision, at most one of them published. A guest page reads
-- the published revision and nothing else, which means a buyer can be halfway
-- through editing without a guest ever seeing a half-finished page. The
-- alternative (a single row with draft and published columns) is the same
-- amount of code and throws away every previous version, and "restore what it
-- said last week" is the request that arrives the day after a bad edit.
--
-- Same content/theme split as templates, for the same reason: the buyer's
-- palette choice is a theme override, not content.

create table public.event_content (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,

  revision integer not null,
  is_published boolean not null default false,

  content_version integer not null,
  content jsonb not null,
  theme jsonb not null default '{"version": 1, "tokens": {}}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_content_revision_positive
    check (revision >= 1),
  constraint event_content_version_positive
    check (content_version >= 1),

  constraint event_content_is_object
    check (jsonb_typeof(content) = 'object'),
  -- coalesce, not a bare comparison: a missing key makes `->` return SQL NULL
  -- and a check constraint that evaluates to NULL passes.
  constraint event_content_has_blocks
    check (coalesce(jsonb_typeof(content -> 'blocks'), '') = 'object'),
  constraint event_content_version_matches_document
    check (case
      when jsonb_typeof(content -> 'version') = 'number'
        then content_version = (content ->> 'version')::integer
      else false
    end),

  constraint event_content_theme_is_object
    check (jsonb_typeof(theme) = 'object'),
  constraint event_content_theme_has_tokens
    check (coalesce(jsonb_typeof(theme -> 'tokens'), '') = 'object'),
  constraint event_content_theme_carries_no_blocks
    check (not (theme ? 'blocks'))
);

create unique index event_content_event_id_revision_key
  on public.event_content (event_id, revision);

-- The whole point of the table: exactly one revision is the live one.
create unique index event_content_one_published_per_event
  on public.event_content (event_id) where is_published;

create index event_content_owner_id_idx on public.event_content (owner_id);

comment on table public.event_content is
  'Buyer customisations per event, one row per revision. Validated by Zod per block in the app; the schema only guarantees shape and versioning.';
comment on column public.event_content.content is
  '{ version, blocks: { <blockId>: {...} } }. Content only. A block reads tokens for every colour, font, radius and spacing value, so none of those belong here.';
comment on column public.event_content.theme is
  'Buyer theme overrides, merged over the template theme. Tokens only.';
comment on column public.event_content.is_published is
  'The revision guests are served. Enforced unique per event by a partial index.';

create trigger event_content_set_updated_at
  before update on public.event_content
  for each row execute function public.set_updated_at();


-- owner_id is denormalised from the parent event so that RLS on this table is a
-- single-column comparison rather than a subquery on every read. Denormalised
-- means it can drift, so it is never taken from the caller: the trigger
-- overwrites whatever was sent with the event's real owner.
create or replace function public.set_owner_from_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select e.owner_id into v_owner from public.events e where e.id = new.event_id;

  if v_owner is null then
    raise exception 'event % does not exist', new.event_id
      using errcode = '23503';
  end if;

  new.owner_id := v_owner;
  return new;
end;
$$;

comment on function public.set_owner_from_event() is
  'Sets owner_id from the parent event, ignoring the caller. Runs as invoker, so a user who cannot see the event gets "does not exist" rather than a hint that it belongs to someone else.';

create trigger event_content_set_owner
  before insert or update on public.event_content
  for each row execute function public.set_owner_from_event();


-- Row level security -------------------------------------------------------

alter table public.event_content enable row level security;
alter table public.event_content force row level security;

revoke all on table public.event_content from public, anon;
grant select, insert, update, delete on table public.event_content to authenticated;
grant all on table public.event_content to service_role;

create policy "event_content: anon has no access"
  on public.event_content as restrictive to anon
  using (false) with check (false);

create policy "event_content: owner full access"
  on public.event_content for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
