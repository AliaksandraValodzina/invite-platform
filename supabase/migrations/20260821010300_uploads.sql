-- uploads: one table for every byte a buyer hands us.
--
-- Buyer photographs, the one music file, and the envelope artwork are the same
-- thing wearing three hats. Each needs somewhere to put bytes, a size limit, a
-- list of formats we will accept, a rule about who answers for the content, and
-- a schedule for throwing it away. Built three times they would differ three
-- ways, and the difference nobody would notice is the one in the retention
-- schedule. So `kind` is a column and not a table.
--
-- Four decisions here are the expensive ones.
--
-- Keys are content addressed and therefore SHARED. An object's key is derived
-- from its own bytes, so two events that upload the same file get one object
-- with two rows pointing at it. That is what makes an edit produce a new URL
-- instead of needing a cache purge, and it is also why nothing in this file
-- ever deletes an object because one row stopped needing it. Deletion goes
-- through platform.upload_objects, which checks whether anybody else still
-- references the key first. Skip that check and a takedown on one wedding
-- blanks the artwork on another.
--
-- Limits are enforced HERE, not in the route. The route checks them too, so a
-- buyer gets a sentence rather than a stack trace, but two uploads in flight at
-- once can both pass a check that reads a count and then insert. A trigger on
-- the insert cannot be raced and cannot be forgotten by the next route that
-- writes to this table.
--
-- The bytes a guest is served are never the bytes a buyer sent. `bytes` and
-- `sha256` describe the original, which exists so a buyer can re-crop; the
-- `variants` array describes what is actually on the page. They have separate
-- retention because they answer to different clocks: the original is only
-- useful to the buyer while they are still editing, and the derivatives have to
-- outlive that by the whole hosting term.
--
-- `content_type` is what the server sniffed, never what the browser claimed. A
-- Content-Type header is a string an attacker chooses, and this column is what
-- the asset route later echoes back to a browser.

create type public.upload_kind as enum ('image', 'audio', 'envelope');

comment on type public.upload_kind is
  'Which of the three uses an upload is for. One capability, three limit sets: see src/lib/uploads/kinds.ts, which is held to the numbers below by a test.';


-- The caps, in one place in the database ------------------------------------
--
-- These are constants in a reviewed migration rather than a settings table, for
-- the same reason the retention windows are: a limit that can be changed
-- without a migration is a limit nobody can vouch for. src/lib/uploads/kinds.ts
-- carries the same numbers so a route can refuse politely, and
-- tests/unit/uploads/limits.test.ts reads this file and fails when the two stop
-- agreeing.

create or replace function public.upload_kind_cap(p_kind public.upload_kind)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'image' then 30
    when 'audio' then 1
    when 'envelope' then 1
  end;
$$;

comment on function public.upload_kind_cap(public.upload_kind) is
  'How many live uploads of one kind an event may hold. Captain, 2026-08-20: 30 images, 1 audio file, 1 envelope image.';

-- 10 MB, decimal, matching the number the product page states. Deliberately
-- generous: refusing a photo straight off a phone is a support ticket, and
-- accepting it and storing an optimised version is the product working.
create or replace function public.upload_max_bytes()
returns bigint
language sql
immutable
set search_path = ''
as $$ select 10000000::bigint $$;

-- What may be STORED and SERVED per event, which is the number that decides the
-- bill. Uploads are capped at 10 MB each on the way in and re-encoded on
-- arrival, so 30 images land well inside this.
create or replace function public.upload_event_variant_budget()
returns bigint
language sql
immutable
set search_path = ''
as $$ select 50000000::bigint $$;

revoke execute on function public.upload_kind_cap(public.upload_kind) from public;
revoke execute on function public.upload_max_bytes() from public;
revoke execute on function public.upload_event_variant_budget() from public;
grant execute on function public.upload_kind_cap(public.upload_kind) to authenticated, service_role;
grant execute on function public.upload_max_bytes() to authenticated, service_role;
grant execute on function public.upload_event_variant_budget() to authenticated, service_role;


create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.upload_kind not null,

  -- The original, as the buyer sent it.
  bytes bigint not null,
  content_type text not null,
  sha256 bytea not null,
  original_key text,
  original_discarded_at timestamptz,

  -- What a guest is actually served. One entry per derivative, each carrying
  -- its own content addressed key, because each derivative's bytes decide its
  -- own URL. Re-encoding with different settings therefore produces different
  -- addresses and nothing anywhere needs invalidating.
  variants jsonb not null,
  variant_bytes bigint not null,

  -- Takedown. A complaint about one song must not take down a wedding page, so
  -- this is per asset and is not a change to the event.
  disabled_at timestamptz,
  disabled_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint uploads_bytes_within_limit
    check (bytes between 1 and 10000000),
  constraint uploads_sha256_is_sha256
    check (octet_length(sha256) = 32),
  constraint uploads_content_type_length
    check (char_length(content_type) between 3 and 100),
  constraint uploads_variants_is_array
    check (jsonb_typeof(variants) = 'array'),
  constraint uploads_variants_not_empty
    check (jsonb_array_length(variants) >= 1),
  constraint uploads_variant_bytes_positive
    check (variant_bytes >= 1),
  -- A discarded original has no key and a key that is gone has a date. Either
  -- half on its own is a row that cannot be reasoned about.
  constraint uploads_discard_is_complete
    check ((original_discarded_at is null) or (original_key is null)),
  constraint uploads_disabled_is_complete
    check ((disabled_at is null) = (disabled_reason is null))
);

-- The same file uploaded twice for the same use costs one row and one object.
-- Buyers re-upload after a failed save more often than it sounds.
create unique index uploads_event_kind_sha256_key
  on public.uploads (event_id, kind, sha256) where deleted_at is null;

create index uploads_event_id_idx on public.uploads (event_id);
create index uploads_owner_id_idx on public.uploads (owner_id);
-- The sweep that discards originals scans this.
create index uploads_original_key_idx on public.uploads (original_key) where original_key is not null;

comment on table public.uploads is
  'One row per file a buyer uploaded, for any of the three uses. Bytes live in an object store behind a platform owned hostname; this table holds the keys, never a URL. docs/uploads.md.';
comment on column public.uploads.bytes is
  'Size of the ORIGINAL as uploaded. What is served is the variants array, which is much smaller.';
comment on column public.uploads.content_type is
  'Sniffed from the leading bytes, never taken from the request. The asset route echoes this to a browser.';
comment on column public.uploads.sha256 is
  'Of the original bytes. Dedupes a re-upload; the served objects are addressed by their own hashes.';
comment on column public.uploads.original_key is
  'Object key of the original, kept only until publication plus 30 days so a buyer can re-crop. Null once discarded.';
comment on column public.uploads.variants is
  'Array of { label, key, content_type, bytes, width, height }. Each key is the sha256 of that object own bytes, which is what earns the immutable cache lifetime.';
comment on column public.uploads.disabled_at is
  'Set by a takedown. The bytes are removed from the store as well: an immutable cache lifetime means an address cannot be un-served any other way.';


-- The object deletion queue -------------------------------------------------
--
-- It lives in `platform` rather than in `public`, for the reason
-- 20260821010100 set out when it put the retention run log there: every table
-- in `public` carries `owner_id` and belongs to a tenant, and
-- `01_tenancy.test.sql` asserts that over the catalogue rather than over a list
-- of names. This table belongs to no tenant, and here that is not merely true
-- but structural: keys are CONTENT ADDRESSED, so two owners who upload the same
-- file share one object. An owner column would name whichever of them happened
-- to be second, and every decision made from it would be wrong. `platform` is
-- not in the Data API's exposed schemas, so this table has no HTTP surface at
-- all; the three functions below are its only door.
--
-- It exists because purge_expired_events deletes the event row and everything
-- under it cascades, so without a queue the bytes would survive in the store
-- forever with nothing left pointing at them. That is exactly the kind of work
-- that gets silently skipped, so it has its own table, its own assertions in
-- 09_uploads.test.sql, and its own line in the sweep's return value.

create table platform.upload_objects (
  key text primary key,
  queued_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint upload_objects_key_shape
    check (key ~ '^[a-f0-9]{24}(?:-[a-z0-9]+)?\.[a-z0-9]{2,5}$')
);

create index upload_objects_pending_idx on platform.upload_objects (queued_at) where deleted_at is null;

comment on table platform.upload_objects is
  'Object keys whose bytes are no longer referenced and should be removed from the store. Drained by POST /api/uploads/sweep, which is the only thing that can reach the store.';

revoke all on table platform.upload_objects from public, anon, authenticated;
grant select, insert, update on table platform.upload_objects to service_role;


-- SECURITY DEFINER because the triggers below run as whoever wrote the row, and
-- a buyer holds no privilege in `platform` at all.
create or replace function public.queue_upload_object(p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into platform.upload_objects (key) values (p_key)
  on conflict (key) do update set queued_at = now(), deleted_at = null;
$$;


-- Every key a row owns, original and derivatives, as one set.
create or replace function public.upload_keys(p_row public.uploads)
returns setof text
language sql
immutable
set search_path = ''
as $$
  select p_row.original_key where p_row.original_key is not null
  union
  select variant ->> 'key'
    from jsonb_array_elements(p_row.variants) as variant
   where variant ->> 'key' is not null;
$$;


-- Queues everything a row referenced, on delete and on soft delete. Whether the
-- bytes actually go is decided later, by claim_upload_objects, because another
-- live row may hold the same key.
create or replace function public.uploads_queue_objects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    return new;
  end if;

  for v_key in select public.upload_keys(case tg_op when 'DELETE' then old else new end) loop
    perform public.queue_upload_object(v_key);
  end loop;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger uploads_queue_objects_on_delete
  after delete on public.uploads
  for each row execute function public.uploads_queue_objects();

create trigger uploads_queue_objects_on_soft_delete
  after update of deleted_at on public.uploads
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.uploads_queue_objects();

revoke execute on function public.queue_upload_object(text) from public;
grant execute on function public.queue_upload_object(text) to service_role;


-- The limits, where they cannot be raced ------------------------------------

create or replace function public.uploads_enforce_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_bytes bigint;
begin
  if new.bytes > public.upload_max_bytes() then
    raise exception 'upload of % bytes is over the % byte limit', new.bytes, public.upload_max_bytes()
      using errcode = 'UP413';
  end if;

  select count(*) into v_count
    from public.uploads u
   where u.event_id = new.event_id
     and u.kind = new.kind
     and u.deleted_at is null
     and u.id <> new.id;

  if v_count >= public.upload_kind_cap(new.kind) then
    raise exception 'event % already holds % uploads of kind %, which is the limit',
      new.event_id, v_count, new.kind
      using errcode = 'UP409';
  end if;

  select coalesce(sum(u.variant_bytes), 0) into v_bytes
    from public.uploads u
   where u.event_id = new.event_id
     and u.deleted_at is null
     and u.id <> new.id;

  if v_bytes + new.variant_bytes > public.upload_event_variant_budget() then
    raise exception 'event % would hold % stored bytes, over the % byte budget',
      new.event_id, v_bytes + new.variant_bytes, public.upload_event_variant_budget()
      using errcode = 'UP507';
  end if;

  return new;
end;
$$;

create trigger uploads_enforce_limits
  before insert on public.uploads
  for each row execute function public.uploads_enforce_limits();

create trigger uploads_set_owner
  before insert or update on public.uploads
  for each row execute function public.set_owner_from_event();

create trigger uploads_set_updated_at
  before update on public.uploads
  for each row execute function public.set_updated_at();


-- Row level security ---------------------------------------------------------

alter table public.uploads enable row level security;
alter table public.uploads force row level security;

revoke all on table public.uploads from public, anon;
grant select, insert, update, delete on table public.uploads to authenticated;
grant all on table public.uploads to service_role;

create policy "uploads: anon has no access"
  on public.uploads as restrictive to anon
  using (false) with check (false);

create policy "uploads: owner full access"
  on public.uploads for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

notify pgrst, 'reload schema';
