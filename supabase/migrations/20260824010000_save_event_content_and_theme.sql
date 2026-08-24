-- A palette is a saveable thing, and the section list lives in the content
-- document.
--
-- Two changes, both small, both here because they are properties of the write
-- rather than of the code that calls it.
--
-- ## 1. `content.sections`
--
-- The content document gains an optional section list: which of the template's
-- sections this invitation has, in what order. It is an override like every
-- other key in that document, so absent means "the template's own list", and
-- every event written before today keeps rendering exactly as it did.
--
-- The check constraint below is the same kind of guarantee the table already
-- gives for `blocks`: shape, and nothing about meaning. Which ids are real, and
-- whether an id names a block this template has, is the app's to say, because
-- the definition lives in another row (see src/lib/template/composition.ts).
--
-- ## 2. `save_event_content` can write the theme
--
-- `event_content.theme` has existed since 20260819010500 and nothing has ever
-- written it. Stage 7 is where a buyer picks their own colours, so it needs a
-- write path, and the question is which one.
--
-- Not a PATCH on the published row. The table holds one row per revision so
-- that "restore what it said last week" is answerable, and a palette edited in
-- place would be the one part of a buyer's page with no history. Not a second
-- function either: two functions minting revision numbers is two places to get
-- the locking wrong.
--
-- So this is the same function, with both documents optional and null meaning
-- "carry the published one forward". The words save sends content and leaves the
-- palette alone; the palette save sends a theme and leaves the words alone; both
-- write one complete new published revision inside one transaction, which is
-- what keeps a guest from ever seeing a half applied change.
--
-- The old two argument signature is DROPPED rather than left beside this one.
-- PostgREST calls a function by named arguments, and an overload that differs
-- only by a defaulted parameter would make `{p_event_id, p_content}` ambiguous:
-- the API would answer 300 rather than choosing. Nothing outside this repo calls
-- it.

alter table public.event_content
  add constraint event_content_sections_is_array
  -- `?` first, because a missing key makes `->` return SQL NULL and a check
  -- constraint that evaluates to NULL passes. The same trap is called out on
  -- every other constraint on this table.
  check (case
    when content ? 'sections' then jsonb_typeof(content -> 'sections') = 'array'
    else true
  end);

comment on column public.event_content.content is
  '{ version, blocks: { <blockId>: {...} }, sections?: [<blockId>...] }. Content and composition only. A block reads tokens for every colour, font, radius and spacing value, so none of those belong here. `sections` absent means the template''s own block list, in the template''s order.';

drop function public.save_event_content(uuid, jsonb);

create function public.save_event_content(
  p_event_id uuid,
  p_content jsonb default null,
  p_theme jsonb default null
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_revision integer;
  v_content jsonb;
  v_version integer;
  v_theme jsonb;
begin
  if p_content is null and p_theme is null then
    raise exception 'a save must carry content, a theme, or both'
      using errcode = '22023';
  end if;

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

  -- Whichever half this save is not sending comes from the revision it is
  -- replacing, so every revision is a complete document rather than a patch
  -- somebody has to replay a chain of.
  select c.content, c.theme into v_content, v_theme
    from public.event_content c
   where c.event_id = p_event_id and c.is_published;

  if p_content is not null then
    v_content := p_content;
  elsif v_content is null then
    raise exception 'event % has no published content revision to carry forward', p_event_id
      using errcode = '22023';
  end if;

  if p_theme is not null then
    v_theme := p_theme;
  end if;

  -- coalesce, not a bare comparison: a missing key makes `->` return SQL NULL,
  -- `jsonb_typeof(null)` is null, and `null <> 'number'` is null rather than
  -- true, so the bare form lets a document with no version straight through to
  -- a not-null violation on content_version.
  if coalesce(jsonb_typeof(v_content -> 'version'), '') <> 'number' then
    raise exception 'content must carry a numeric version'
      using errcode = '22023';
  end if;

  v_version := (v_content ->> 'version')::integer;

  update public.event_content c
     set is_published = false
   where c.event_id = p_event_id and c.is_published;

  insert into public.event_content
    (owner_id, event_id, revision, is_published, content_version, content, theme)
  values
    -- owner_id is overwritten by event_content_set_owner from the event itself,
    -- so what is passed here is ignored. auth.uid() is what the caller is, and
    -- the trigger is what makes the column true rather than merely supplied.
    (auth.uid(), p_event_id, v_revision, true, v_version, v_content,
     coalesce(v_theme, '{"version": 1, "tokens": {}}'::jsonb));

  return v_revision;
end;
$$;

comment on function public.save_event_content(uuid, jsonb, jsonb) is
  'Writes a new published content revision for one event, atomically. Runs as the caller, so RLS decides whose event it is. Either document may be null, which carries the published one forward: the words save leaves the palette alone and the palette save leaves the words alone.';

revoke execute on function public.save_event_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_event_content(uuid, jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
