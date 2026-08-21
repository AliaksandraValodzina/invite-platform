-- Retention over uploads, folded into the sweep that already exists.
--
-- Uploads are buyer data rather than guest data, so they follow the event and
-- not the RSVP schedule. There is no second scheme and no second scheduler: the
-- daily job from 20260819010900 gains two lines and reports what they did.
--
-- Timeline for one event's bytes:
--
--   published_at ............ originals kept, so a buyer can re-crop
--   published_at + 30d ...... ORIGINALS discarded. This is the step that drops
--                             steady state storage by roughly 85%, because an
--                             original is an order of magnitude larger than
--                             everything served from it put together. A buyer
--                             who wants to re-crop after that re-uploads.
--   grace_ends_at ........... DERIVATIVES discarded. After grace the slug
--                             serves the designed expiry page and no asset on
--                             it is ever requested again, so keeping the bytes
--                             costs money to serve nobody.
--   grace_ends_at + 365d .... the event row is deleted by the existing tier 2
--                             purge and the uploads rows cascade with it. The
--                             cascade is why the queue below exists: without it
--                             the bytes would outlive every row that knew
--                             their keys.
--
-- Nothing here reaches the object store, and that is on purpose. Postgres
-- cannot make an HTTP request, and a retention rule that depends on one would
-- be a rule that silently stops running the day a network call starts failing.
-- So the database's job is to decide, and it records the decision as a row in
-- platform.upload_objects. POST /api/uploads/sweep is the only thing that
-- touches bytes, and it marks each key done as it goes, so an interrupted run
-- resumes rather than losing the list.

/** Days after an event is published that the buyer's originals are discarded. */
create or replace function public.upload_original_retention_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30 $$;

revoke execute on function public.upload_original_retention_days() from public;
grant execute on function public.upload_original_retention_days() to authenticated, service_role;


-- Step one: the originals.
--
-- Written as a CTE rather than as an UPDATE ... RETURNING because the key has
-- to be captured BEFORE the statement clears it. `returning` on an UPDATE hands
-- back the new row, whose original_key is already null, so the obvious version
-- of this queues nothing and leaves the bytes in the store forever with a green
-- log line saying otherwise.
create or replace function public.discard_expired_upload_originals(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select u.id, u.original_key
      from public.uploads u
      join public.events e on e.id = u.event_id
     where u.deleted_at is null
       and u.original_key is not null
       and e.published_at is not null
       and e.published_at + make_interval(days => public.upload_original_retention_days()) <= p_now
  ),
  cleared as (
    update public.uploads u
       set original_key = null,
           original_discarded_at = p_now
      from due
     where u.id = due.id
    returning due.original_key as key
  ),
  queued as (
    insert into platform.upload_objects (key)
    select key from cleared
    on conflict (key) do update set queued_at = now(), deleted_at = null
    returning 1
  )
  select count(*)::integer into v_count from queued;

  return v_count;
end;
$$;

comment on function public.discard_expired_upload_originals(timestamptz) is
  'Discards buyer originals 30 days after publication and queues their objects for removal. Derivatives are untouched. Idempotent.';


-- Step two: the derivatives, once the page has stopped serving for good.
create or replace function public.discard_expired_upload_derivatives(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- The soft delete fires uploads_queue_objects_on_soft_delete, which queues
  -- every key this row held. Whether the bytes actually go is decided at drain
  -- time, because content addressed keys are shared between events.
  update public.uploads u
     set deleted_at = p_now
    from public.events e
   where e.id = u.event_id
     and u.deleted_at is null
     and e.grace_ends_at <= p_now;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.discard_expired_upload_derivatives(timestamptz) is
  'Soft deletes every upload for an event whose grace period has ended, queueing its objects. After grace the slug serves the designed expiry page, so no asset on it is ever requested again.';


-- Takedown ------------------------------------------------------------------
--
-- One asset off, without touching the event. A complaint about one song must
-- not blank a wedding page, and the buyer must not have to unpublish to comply.
--
-- Disabling deletes the bytes rather than hiding the row, and that is forced by
-- the caching decision: every served address carries a one year immutable cache
-- lifetime, so there is no header, no purge and no flag that can un-serve a URL
-- somebody already holds. Removing the object is the only thing that actually
-- stops it. Anyone still holding the URL keeps their copy until it expires,
-- which is the honest limit of what a takedown can do here and is worth
-- knowing before promising a response time.
create or replace function public.disable_upload(p_upload_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found integer;
begin
  update public.uploads u
     set disabled_at = now(),
         disabled_reason = p_reason,
         deleted_at = coalesce(u.deleted_at, now())
   where u.id = p_upload_id
     and u.disabled_at is null;

  get diagnostics v_found = row_count;
  return v_found > 0;
end;
$$;

comment on function public.disable_upload(uuid, text) is
  'Takedown for one asset. Marks it disabled and queues its objects for removal from the store; the event and every other asset on it keep working.';


-- Draining the queue --------------------------------------------------------

/**
 * Keys whose bytes may actually be removed.
 *
 * The reference check is the load bearing half. Keys are content addressed, so
 * two events that uploaded the same file share one object, and deleting it
 * because one of them finished would blank the other one's page. This is also
 * what makes disable_upload safe: a takedown on one event removes bytes only
 * when nobody else is standing on them.
 */
create or replace function public.claim_upload_objects(p_limit integer default 200)
returns setof text
language sql
security definer
set search_path = ''
as $$
  select o.key
    from platform.upload_objects o
   where o.deleted_at is null
     and not exists (
       select 1
         from public.uploads u, public.upload_keys(u) as k(key)
        where u.deleted_at is null
          and k.key = o.key
     )
   order by o.queued_at
   limit greatest(p_limit, 0);
$$;

comment on function public.claim_upload_objects(integer) is
  'Object keys that are queued and that no live upload still references. The reference check is what stops a takedown on one event blanking another that uploaded the same file.';


create or replace function public.mark_upload_object_deleted(p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found integer;
begin
  update platform.upload_objects o
     set deleted_at = now()
   where o.key = p_key and o.deleted_at is null;

  get diagnostics v_found = row_count;
  return v_found > 0;
end;
$$;


-- The sweep, with two more steps -------------------------------------------
--
-- Order matters and is fixed here rather than left to a caller. Originals
-- first, because the derivative step soft deletes the rows the original step
-- reads. Purge last, because it deletes the events both of them join to.
--
-- The operator's record grows two columns rather than getting a table of its
-- own, for the same reason there is one sweep rather than two: a day with no
-- row is the alert, and an alert that has to watch two places is one that will
-- be watching the wrong one.

alter table platform.retention_runs
  add column upload_originals_discarded integer not null default 0,
  add column upload_derivatives_discarded integer not null default 0;

alter table platform.retention_runs
  add constraint retention_runs_upload_counts_not_negative
    check (upload_originals_discarded >= 0 and upload_derivatives_discarded >= 0);

create or replace function public.run_retention_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted jsonb;
  v_originals integer;
  v_derivatives integer;
  v_purged integer;
begin
  v_redacted := public.redact_expired_rsvp_pii(p_now);
  v_originals := public.discard_expired_upload_originals(p_now);
  v_derivatives := public.discard_expired_upload_derivatives(p_now);
  v_purged := public.purge_expired_events(p_now);

  insert into platform.retention_runs (
    ran_at, replies_redacted, answers_redacted, events_purged,
    upload_originals_discarded, upload_derivatives_discarded
  )
  values (
    p_now,
    (v_redacted ->> 'replies')::integer,
    (v_redacted ->> 'answers')::integer,
    v_purged,
    v_originals,
    v_derivatives
  );

  return jsonb_build_object(
    'ran_at', p_now,
    'rsvps_redacted', (v_redacted ->> 'replies')::integer,
    'rsvp_answers_redacted', (v_redacted ->> 'answers')::integer,
    'upload_originals_discarded', v_originals,
    'upload_derivatives_discarded', v_derivatives,
    'events_purged', v_purged,
    'objects_awaiting_deletion', (
      select count(*)::integer from platform.upload_objects where deleted_at is null
    )
  );
end;
$$;

comment on function public.run_retention_sweep(timestamptz) is
  'Runs every retention step in order, records the run in platform.retention_runs and returns a summary. objects_awaiting_deletion is a number a human should look at: it only falls when POST /api/uploads/sweep runs, which is the half of this that Postgres cannot do.';


revoke execute on function public.discard_expired_upload_originals(timestamptz) from public;
revoke execute on function public.discard_expired_upload_derivatives(timestamptz) from public;
revoke execute on function public.disable_upload(uuid, text) from public;
revoke execute on function public.claim_upload_objects(integer) from public;
revoke execute on function public.mark_upload_object_deleted(text) from public;

grant execute on function public.discard_expired_upload_originals(timestamptz) to service_role;
grant execute on function public.discard_expired_upload_derivatives(timestamptz) to service_role;
grant execute on function public.disable_upload(uuid, text) to service_role;
grant execute on function public.claim_upload_objects(integer) to service_role;
grant execute on function public.mark_upload_object_deleted(text) to service_role;

notify pgrst, 'reload schema';
