-- Storing one reply, in one transaction, at one clock.
--
-- Why this is a function and not two inserts from the API route. A reply is an
-- envelope plus its answers, and PostgREST cannot put two tables in one
-- transaction. Two requests can half succeed, and the half that succeeds is the
-- envelope: the buyer would open their dashboard and find a reply from nobody,
-- with a party size and no name, and no way to tell whether the guest is coming
-- or the write broke. That is the shape of failure this schema keeps refusing
-- to allow.
--
-- Three things only the database can do properly, all of which happen here:
--
--   1. The serving state is read inside the transaction that does the write, so
--      "RSVPs close at hosting expiry" is checked against the clock at the
--      moment of the write. The guest page may be up to a minute stale by
--      design (src/lib/serving/cache.ts); this is not, and that is what stops a
--      cached page from collecting new guest PII against lapsed hosting.
--   2. The prompt, the type and the PII class are copied from the question row
--      here, not accepted from the caller. A snapshot the caller supplies is a
--      snapshot the caller can get wrong, and the one that decides what the
--      retention sweep erases is not a value to take on trust.
--   3. A question id that belongs to another event is refused rather than
--      stored, which no amount of validation in a route can guarantee once two
--      requests are in flight.
--
-- What it deliberately does not do is decide whether a required question was
-- answered. That check lives in the route, because the guest needs to be told
-- which question, next to which control, and because a question retired between
-- the page rendering and the guest pressing send should not lose them their
-- whole reply. An answer to a question retired in that window is skipped, and
-- the count in the return value is what says so.

create or replace function public.submit_rsvp(
  p_slug text,
  p_attendance public.rsvp_attendance,
  p_party_size integer,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_state public.event_serving_state;
  v_rsvp_id uuid;
  v_stored integer;
  v_unknown integer;
begin
  select e.* into v_event from public.events e where e.slug = p_slug;

  if v_event.id is null then
    raise exception 'no event at slug %', p_slug using errcode = 'RS404';
  end if;

  v_state := public.event_state_at(
    v_event.status, v_event.hosting_expires_at, v_event.grace_ends_at, now()
  );

  -- `live` and nothing else. Grace keeps a shared link working; it does not
  -- keep collecting personal information against hosting somebody stopped
  -- paying for.
  if v_state <> 'live' then
    raise exception 'replies are closed for slug % (state %)', p_slug, v_state
      using errcode = 'RS409';
  end if;

  if jsonb_typeof(p_answers) <> 'array' then
    raise exception 'answers must be a json array' using errcode = 'RS422';
  end if;

  -- An answer naming a question that is not this event's is an integrity
  -- failure rather than a validation one, and it is refused before anything is
  -- written.
  select count(*) into v_unknown
    from jsonb_array_elements(p_answers) as answer
   where not exists (
     select 1 from public.rsvp_questions q
      where q.id = (answer ->> 'question_id')::uuid
        and q.event_id = v_event.id
   );

  if v_unknown > 0 then
    raise exception '% answer(s) name a question that does not belong to this event', v_unknown
      using errcode = 'RS422';
  end if;

  insert into public.rsvps (owner_id, event_id, attendance, party_size)
  values (
    v_event.owner_id,
    v_event.id,
    p_attendance,
    case when p_attendance = 'attending' then p_party_size else 0 end
  )
  returning id into v_rsvp_id;

  insert into public.rsvp_answers (
    owner_id, event_id, rsvp_id, question_id,
    question_prompt, question_type, pii_class,
    value_text, value_choice, value_number
  )
  select
    v_event.owner_id,
    v_event.id,
    v_rsvp_id,
    q.id,
    q.prompt,
    q.type,
    q.pii_class,
    nullif(answer ->> 'value_text', ''),
    case
      when jsonb_typeof(answer -> 'value_choice') = 'array'
        then array(select jsonb_array_elements_text(answer -> 'value_choice'))
    end,
    (answer ->> 'value_number')::numeric
  from jsonb_array_elements(p_answers) as answer
  join public.rsvp_questions q
    on q.id = (answer ->> 'question_id')::uuid
   and q.event_id = v_event.id
   -- Retired between the page rendering and the guest pressing send. Their
   -- reply is worth more than the answer to a question the buyer just removed.
   and q.retired_at is null;

  get diagnostics v_stored = row_count;

  return jsonb_build_object(
    'rsvp_id', v_rsvp_id,
    'answers_stored', v_stored,
    'answers_skipped', jsonb_array_length(p_answers) - v_stored
  );
end;
$$;

comment on function public.submit_rsvp(text, public.rsvp_attendance, integer, jsonb) is
  'Stores one guest reply and its answers in one transaction. Re-reads the serving state at write time, so a page cached for up to a minute cannot collect a reply against lapsed hosting. Snapshots the prompt, type and PII class from the question row rather than from the caller.';

-- The route calls this with the service role, and nothing else calls it.
revoke execute on function public.submit_rsvp(text, public.rsvp_attendance, integer, jsonb) from public;
grant execute on function public.submit_rsvp(text, public.rsvp_attendance, integer, jsonb) to service_role;

notify pgrst, 'reload schema';
