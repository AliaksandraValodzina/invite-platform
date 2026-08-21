-- Saving a buyer's content, as one statement that cannot half happen.
--
-- `public.event_content` was built to hold one row per saved revision with at
-- most one of them published, and a partial unique index enforces the second
-- half of that. Which means a save is two writes that have to agree: the
-- revision that was published stops being published, and the new one starts.
-- Sent as two requests from the application, a failure between them leaves an
-- event with nothing published at all, which the guest page answers with
-- "published but has no published content revision" (src/lib/supabase/events.ts).
-- That is a designed notice standing in for an invitation somebody paid for,
-- caused by a network blip, and it is exactly the state a transaction exists to
-- make impossible.
--
-- So a save is a function. A function body is a transaction, both writes land or
-- neither does, and the unique index is never seen half satisfied.
--
-- ## Every save is a new revision
--
-- Not an update in place. The table's own comment says why: "restore what it
-- said last week" is the request that arrives the day after a bad edit, and a
-- single row that is edited in place has thrown that away before anybody knows
-- they wanted it. There is no draft state here and no preview: each save is a
-- complete document and each one goes live, which is the smallest thing that is
-- both honest about what a guest sees and keeps the history the table was
-- shaped for. A draft that is edited over several sittings and published once is
-- the other half of the editor and is not this.
--
-- ## SECURITY INVOKER, deliberately
--
-- This function runs as the caller, so row level security is what decides whose
-- event this is. A definer function would need its own ownership check written
-- in SQL, which is a second answer to a question the policy already answers, and
-- the two would disagree eventually. An event the caller cannot see raises
-- "does not exist", which is also the correct amount of information to give
-- somebody guessing at ids.
--
-- ## What it carries forward
--
-- The theme override. A buyer's palette lives in `event_content.theme` beside
-- their content, so a new revision that took the column default would silently
-- put every event back to its template palette on the first save. It is copied
-- from the revision being replaced.

create or replace function public.save_event_content(
  p_event_id uuid,
  p_content jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_revision integer;
  v_theme jsonb;
  v_version integer;
begin
  -- coalesce, not a bare comparison: a missing key makes `->` return SQL NULL,
  -- `jsonb_typeof(null)` is null, and `null <> 'number'` is null rather than
  -- true, so the bare form lets a document with no version straight through to
  -- a not-null violation on content_version. The same trap is called out on the
  -- check constraints in 20260819010500_event_content.sql.
  if coalesce(jsonb_typeof(p_content -> 'version'), '') <> 'number' then
    raise exception 'content must carry a numeric version'
      using errcode = '22023';
  end if;

  v_version := (p_content ->> 'version')::integer;

  -- Locks the event for the duration, so two saves in flight cannot pick the
  -- same revision number and collide on event_content_event_id_revision_key.
  -- It is also the ownership check: under RLS this selects nothing for an event
  -- that is not the caller's, and an event that does not exist looks the same.
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'event % does not exist', p_event_id
      using errcode = '23503';
  end if;

  select coalesce(max(c.revision), 0) + 1 into v_revision
    from public.event_content c
   where c.event_id = p_event_id;

  select c.theme into v_theme
    from public.event_content c
   where c.event_id = p_event_id and c.is_published;

  update public.event_content c
     set is_published = false
   where c.event_id = p_event_id and c.is_published;

  insert into public.event_content
    (owner_id, event_id, revision, is_published, content_version, content, theme)
  values
    -- owner_id is overwritten by event_content_set_owner from the event itself,
    -- so what is passed here is ignored. auth.uid() is what the caller is, and
    -- the trigger is what makes the column true rather than merely supplied.
    (auth.uid(), p_event_id, v_revision, true, v_version, p_content,
     coalesce(v_theme, '{"version": 1, "tokens": {}}'::jsonb));

  return v_revision;
end;
$$;

comment on function public.save_event_content(uuid, jsonb) is
  'Writes a new published content revision for one event, atomically. Runs as the caller, so RLS decides whose event it is. Carries the theme override forward from the revision it replaces.';

revoke execute on function public.save_event_content(uuid, jsonb) from public, anon;
grant execute on function public.save_event_content(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
