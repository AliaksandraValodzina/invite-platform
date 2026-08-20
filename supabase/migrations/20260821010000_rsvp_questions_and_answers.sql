-- The extensible answer model, built at the moment the write path is first
-- built rather than retrofitted.
--
-- Until this migration a reply was four fixed columns on `rsvps`. Five question
-- types ship now and a sixth has to be an addition rather than a migration,
-- which is not a property four columns can have. Rewriting this once a thousand
-- events hold real guest replies is the second most expensive migration this
-- product can do, after the tenancy one it already avoided, and it is free
-- today because no row exists anywhere.
--
-- Three tables, and the split is the whole design:
--
--   rsvps            the envelope. Attendance and party size, which are never
--                    optional and never a question, so the headcount query does
--                    not depend on the answer model.
--   rsvp_questions   what an event asks. One row per question, retired rather
--                    than deleted.
--   rsvp_answers     what one guest said to one question, with the prompt, the
--                    type and the classification snapshotted onto the row.
--
-- Two rules are enforced here by the schema rather than by the application
-- remembering them:
--
--   A reply is an immutable record of what was answered at the time. The
--   snapshot columns and a BEFORE UPDATE trigger say so; editing a question
--   later cannot rewrite history.
--
--   Deleting a question retires it. The foreign key from answers is ON DELETE
--   RESTRICT and `authenticated` holds no DELETE privilege on questions at all,
--   so a buyer tidying their form cannot destroy replies someone already gave.
--
-- And one column is load bearing beyond its own table. `pii_class` is what lets
-- the retention sweep know what to erase without reading the prompt text.
-- Without it an extensible question set is an unbounded personal data surface
-- and the database enforced redaction guarantee stops meaning anything.


-- Types ---------------------------------------------------------------------

-- Five now. A sixth is `alter type ... add value`, which is the cheap direction
-- this schema's enum note already identifies, and scripts/prove-question-type-addition.mjs
-- runs that addition against a database holding real answers to show it needs
-- no table rewrite and no row rewrite.
create type public.rsvp_question_type as enum (
  'short_answer',
  'long_answer',
  'multiple_choice',
  'checkbox',
  'email'
);

comment on type public.rsvp_question_type is
  'What kind of question a guest is answering. Grows with `alter type ... add value`; the value columns on rsvp_answers are typed by shape rather than by type so that a new type fitting an existing shape needs no table change.';

-- What kind of personal information an answer to this question holds.
--
--   none       not about a person at all. Survives redaction, which is how a
--              buyer keeps a headcount, mirroring attendance and party size.
--   identity   names, and free text a named person wrote about themselves.
--   contact    email, phone, postal address.
--   sensitive  health, dietary, religion, anything that implies them.
--
-- Only `none` is treated differently by the retention sweep: everything else is
-- erased on the same day. The finer classes are not decoration. They are what
-- the privacy document describes, what a buyer declares when they add a
-- question, and what a future rule that treats sensitive data differently would
-- select on without going near the prompt text.
create type public.rsvp_pii_class as enum ('none', 'identity', 'contact', 'sensitive');

comment on type public.rsvp_pii_class is
  'What the answer holds about a person. Snapshotted onto every answer so the retention sweep never has to read a prompt to know what to erase.';

-- The three shapes an answer can be stored in. This is the reason a sixth
-- question type is an addition: value columns are typed by shape, so a new type
-- that maps onto text, a choice list or a number needs an enum value and a
-- branch, not a column.
create type public.rsvp_value_shape as enum ('text', 'choice', 'number');

comment on type public.rsvp_value_shape is
  'Which value column on rsvp_answers a question type stores into. Adding a question type means adding a branch to public.rsvp_answer_shape(rsvp_question_type), not a column.';

-- The one map from question type to storage shape. It is a function and not a
-- check constraint listing types, because a constraint that enumerates types
-- has to be rewritten (and the whole table revalidated) every time a type is
-- added, which is the migration this design exists to avoid.
create or replace function public.rsvp_answer_shape(p_type public.rsvp_question_type)
returns public.rsvp_value_shape
language sql
immutable
set search_path = ''
as $$
  select (case p_type
    when 'short_answer' then 'text'
    when 'long_answer' then 'text'
    when 'email' then 'text'
    when 'multiple_choice' then 'choice'
    when 'checkbox' then 'choice'
  end)::public.rsvp_value_shape;
$$;

comment on function public.rsvp_answer_shape(public.rsvp_question_type) is
  'Maps a question type to the value column its answers use. Returns null for a type nobody has mapped yet, which public.rsvp_answers_before_write turns into a loud refusal rather than a silently unstored answer.';

revoke execute on function public.rsvp_answer_shape(public.rsvp_question_type) from public;
grant execute on function public.rsvp_answer_shape(public.rsvp_question_type) to authenticated, service_role;


-- rsvp_questions ------------------------------------------------------------

create table public.rsvp_questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,

  type public.rsvp_question_type not null,
  prompt text not null,
  position integer not null,
  required boolean not null default false,

  -- [{ "value": "...", "label": "..." }, ...] for the choice shapes, null for
  -- everything else. A stable value plus a display label, so relabelling a
  -- choice does not orphan the answers already stored against its value.
  options jsonb,

  pii_class public.rsvp_pii_class not null,

  -- Removal. Never a row delete: see the foreign key from rsvp_answers.
  retired_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A cap on prompt length is a privacy control before it is a validation one:
  -- it bounds what a buyer can ask a stranger to write about themselves.
  constraint rsvp_questions_prompt_length
    check (char_length(prompt) between 1 and 200),
  constraint rsvp_questions_position_positive
    check (position >= 1),

  -- The document shape of the options list. Which types must carry one, and
  -- what each element has to contain, is enforced by the trigger below: a check
  -- constraint cannot walk a jsonb array, and one that enumerated question
  -- types would have to be rewritten and revalidated for every type added,
  -- which is the migration this design exists to avoid.
  constraint rsvp_questions_options_shape
    check (options is null or (
      jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) between 2 and 20
    ))
);

-- One question per position per event, and retiring one frees its position.
create unique index rsvp_questions_event_position_key
  on public.rsvp_questions (event_id, position) where retired_at is null;
create index rsvp_questions_event_id_idx on public.rsvp_questions (event_id);
create index rsvp_questions_owner_id_idx on public.rsvp_questions (owner_id);

comment on table public.rsvp_questions is
  'What one event asks its guests. Retired, never deleted: rsvp_answers references this table ON DELETE RESTRICT so a buyer tidying their form cannot take replies with it.';
comment on column public.rsvp_questions.pii_class is
  'What answers to this question will hold about a person. Copied onto every answer at answer time, which is what lets the retention sweep work without reading prompts.';
comment on column public.rsvp_questions.retired_at is
  'Set to remove a question from the form. The row stays forever because answers point at it.';
comment on column public.rsvp_questions.options is
  'Choice list for multiple_choice and checkbox, as [{value,label}]. Null for every other shape. Values are what answers store, so a label can be reworded without orphaning an answer.';

create trigger rsvp_questions_set_updated_at
  before update on public.rsvp_questions
  for each row execute function public.set_updated_at();

create trigger rsvp_questions_set_owner
  before insert or update on public.rsvp_questions
  for each row execute function public.set_owner_from_event();


-- Two rules a check constraint cannot express, and one of them is a privacy
-- control.
--
-- The cap. The single largest privacy consequence of making the RSVP extensible
-- is that a buyer can ask for more than the platform intended. Twelve does not
-- stop a badly chosen question, but it does stop an RSVP form becoming a
-- questionnaire, and it is the kind of limit that has to exist before the
-- authoring surface does rather than after somebody finds the edge.
--
-- The options list. Which types carry one is read from the shape function, so a
-- sixth question type needs no edit here at all.
create or replace function public.rsvp_questions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_shape public.rsvp_value_shape;
  v_values text[];
begin
  v_shape := public.rsvp_answer_shape(new.type);

  if v_shape is null then
    raise exception 'question type % has no storage shape: add a branch to public.rsvp_answer_shape', new.type
      using errcode = '22023';
  end if;

  if v_shape = 'choice' then
    if new.options is null then
      raise exception 'a % question needs an options list', new.type
        using errcode = '23514';
    end if;

    select array_agg(option ->> 'value') into v_values
      from jsonb_array_elements(new.options) as option;

    if exists (
      select 1 from jsonb_array_elements(new.options) as option
       where jsonb_typeof(option) <> 'object'
          or jsonb_typeof(option -> 'value') <> 'string'
          or jsonb_typeof(option -> 'label') <> 'string'
          or char_length(option ->> 'value') not between 1 and 80
          or char_length(option ->> 'label') not between 1 and 120
    ) then
      raise exception 'each option must be {"value": text, "label": text} within length'
        using errcode = '23514';
    end if;

    -- Answers store the value, so two options sharing one would be two answers
    -- nobody can tell apart.
    if array_length(v_values, 1) <> cardinality(array(select distinct unnest(v_values))) then
      raise exception 'option values must be unique within a question'
        using errcode = '23514';
    end if;
  elsif new.options is not null then
    raise exception 'a % question stores its answers as %, so it carries no options list', new.type, v_shape
      using errcode = '23514';
  end if;

  if new.retired_at is null then
    select count(*) into v_count
      from public.rsvp_questions q
     where q.event_id = new.event_id
       and q.retired_at is null
       and q.id <> new.id;

    if v_count >= 12 then
      raise exception 'an event may ask at most 12 live RSVP questions (event %)', new.event_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger rsvp_questions_before_write
  before insert or update on public.rsvp_questions
  for each row execute function public.rsvp_questions_before_write();

comment on function public.rsvp_questions_before_write() is
  'Caps live questions per event at 12 and holds the options list to the shape the question type stores into. An extensible question set with no ceiling is an unbounded personal data surface.';


-- rsvp_answers --------------------------------------------------------------
--
-- One row per question a guest actually answered. An optional question left
-- blank stores nothing at all, so absence means "not answered" and a null value
-- column never has to carry two meanings.

create table public.rsvp_answers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,

  rsvp_id uuid not null references public.rsvps (id) on delete cascade,

  -- RESTRICT, and it is the point of the column. A cascade here would make
  -- "deleting a question destroys the replies to it" possible, which is the one
  -- thing the captain ruled out, and a rule enforced by the application
  -- remembering is a rule that survives until the first busy afternoon.
  question_id uuid not null references public.rsvp_questions (id) on delete restrict,

  -- The snapshot. A reply is an immutable record of what was answered at the
  -- time, so editing a question later must not rewrite history: the prompt the
  -- guest actually read, the type they answered in, and the classification the
  -- answer was collected under all live on this row.
  question_prompt text not null,
  question_type public.rsvp_question_type not null,
  pii_class public.rsvp_pii_class not null,

  -- Typed by shape, not by question type. This is what makes a sixth question
  -- type an addition: one that maps onto text, a choice list or a number needs
  -- no column here at all.
  value_text text,
  value_choice text[],
  value_number numeric,

  answered_at timestamptz not null default now(),
  pii_redacted_at timestamptz,

  constraint rsvp_answers_prompt_length
    check (char_length(question_prompt) between 1 and 200),
  constraint rsvp_answers_value_text_length
    check (value_text is null or char_length(value_text) <= 2000),
  constraint rsvp_answers_value_choice_bounds
    check (value_choice is null or (
      array_length(value_choice, 1) is null or array_length(value_choice, 1) <= 20
    )),

  -- Redaction means something the database enforces, not something a sweep
  -- claims. Either nothing has been redacted, or the answer was classed as
  -- holding nothing about a person, or every value column is null. A
  -- half-redacted row cannot exist, so a sweep that half worked fails loudly
  -- instead of leaving plausible rows behind.
  constraint rsvp_answers_redaction_is_complete
    check (
      pii_redacted_at is null
      or pii_class = 'none'
      or (value_text is null and value_choice is null and value_number is null)
    ),

  -- An answer holds exactly one value, in exactly one column, until it is
  -- redacted. An empty checkbox is an empty array, which is a value: the guest
  -- read the question and ticked nothing.
  constraint rsvp_answers_carry_one_value
    check (
      (pii_redacted_at is not null and pii_class <> 'none')
      or (
        (value_text is not null)::integer
        + (value_choice is not null)::integer
        + (value_number is not null)::integer
      ) = 1
    )
);

create index rsvp_answers_rsvp_id_idx on public.rsvp_answers (rsvp_id);
create index rsvp_answers_question_id_idx on public.rsvp_answers (question_id);
create index rsvp_answers_owner_id_idx on public.rsvp_answers (owner_id);
-- The retention sweep only ever looks at answers it has not swept yet.
create index rsvp_answers_pending_redaction_idx
  on public.rsvp_answers (event_id) where pii_redacted_at is null;

comment on table public.rsvp_answers is
  'One guest answer to one question, with the prompt, type and PII class snapshotted at answer time. Guests PII. Written only through an API route with the service role.';
comment on column public.rsvp_answers.question_prompt is
  'The prompt as the guest read it. Snapshotted so that rewording a question later does not rewrite what anybody was asked.';
comment on column public.rsvp_answers.pii_class is
  'Snapshotted from the question. The retention sweep reads this column and never the prompt.';
comment on column public.rsvp_answers.value_choice is
  'Chosen option values. One element for multiple_choice, zero or more for checkbox: the shape, not the type, decides the column.';


-- The value column an answer uses has to match its type's shape, and an answer
-- is immutable except for redaction. Both are enforced here rather than in a
-- check constraint: the first because a constraint enumerating types would have
-- to be rewritten for every new type, and the second because it is a rule about
-- the change rather than about the row.
create or replace function public.rsvp_answers_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_shape public.rsvp_value_shape;
  v_parent_redacted timestamptz;
begin
  if tg_op = 'UPDATE' then
    -- The only permitted update is a redaction: values going away and the
    -- timestamp arriving. Everything else about an answer is history.
    if new.id is distinct from old.id
       or new.rsvp_id is distinct from old.rsvp_id
       or new.question_id is distinct from old.question_id
       or new.question_prompt is distinct from old.question_prompt
       or new.question_type is distinct from old.question_type
       or new.pii_class is distinct from old.pii_class
       or new.answered_at is distinct from old.answered_at
       or new.event_id is distinct from old.event_id then
      raise exception 'an rsvp answer is an immutable record of what was answered at the time (answer %)', old.id
        using errcode = '23514';
    end if;

    if old.pii_redacted_at is not null and new.pii_redacted_at is null then
      raise exception 'a redacted answer cannot be un-redacted (answer %)', old.id
        using errcode = '23514';
    end if;

    -- A value may go away. It may never become something else. That covers
    -- every class, including `none`: what a guest ticked is history too.
    if (new.value_text is distinct from old.value_text and new.value_text is not null)
       or (new.value_choice is distinct from old.value_choice and new.value_choice is not null)
       or (new.value_number is distinct from old.value_number and new.value_number is not null) then
      raise exception 'an rsvp answer may only be updated to erase its value (answer %)', old.id
        using errcode = '23514';
    end if;

    return new;
  end if;

  v_shape := public.rsvp_answer_shape(new.question_type);

  if v_shape is null then
    raise exception 'question type % has no storage shape: add a branch to public.rsvp_answer_shape', new.question_type
      using errcode = '22023';
  end if;

  if (v_shape = 'text' and new.value_text is null)
     or (v_shape = 'choice' and new.value_choice is null)
     or (v_shape = 'number' and new.value_number is null) then
    raise exception 'a % answer stores its value in the % column', new.question_type, v_shape
      using errcode = '23514';
  end if;

  -- Nothing may be added to a reply whose personal information has already been
  -- erased. Without this, redaction would be a claim about a moment rather than
  -- about a row: the envelope would say redacted while holding a fresh allergy
  -- note.
  select r.pii_redacted_at into v_parent_redacted from public.rsvps r where r.id = new.rsvp_id;
  if v_parent_redacted is not null and new.pii_class <> 'none' and new.pii_redacted_at is null then
    raise exception 'the reply this answer belongs to has already been redacted (rsvp %)', new.rsvp_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.rsvp_answers_before_write() is
  'Enforces the two rules a check constraint cannot: an answer stores into the column its type shape names, and an answer never changes except to be erased.';

create trigger rsvp_answers_before_write
  before insert or update on public.rsvp_answers
  for each row execute function public.rsvp_answers_before_write();

create trigger rsvp_answers_set_owner
  before insert or update on public.rsvp_answers
  for each row execute function public.set_owner_from_event();


-- rsvps becomes the envelope ------------------------------------------------
--
-- The four fixed columns move to the answer model. Attendance and party size
-- stay here because neither is ever optional and because the headcount query
-- must not depend on which questions an event happens to ask.
--
-- Nothing is migrated, because nothing is deployed and no row exists. That is
-- exactly why this happens now: the same change with a thousand events in it is
-- a data migration over other people's personal information.

alter table public.rsvps drop constraint rsvps_redaction_is_complete;
alter table public.rsvps drop constraint rsvps_guest_name_length;
alter table public.rsvps drop constraint rsvps_guest_email_normalised;
alter table public.rsvps drop constraint rsvps_dietary_notes_length;
alter table public.rsvps drop constraint rsvps_message_length;

alter table public.rsvps drop column guest_name;
alter table public.rsvps drop column guest_email;
alter table public.rsvps drop column dietary_notes;
alter table public.rsvps drop column message;

comment on table public.rsvps is
  'The envelope of one guest reply: attendance and party size, which are never questions. What the guest wrote is in rsvp_answers. Written only through an API route with the service role.';
comment on column public.rsvps.pii_redacted_at is
  'When this reply was swept. The envelope itself holds nothing identifying; the timestamp records that its answers were dealt with, and public.rsvp_answers_before_write refuses to add personal information to a reply carrying it.';


-- Row level security --------------------------------------------------------
--
-- Both new tables follow the shape rsvps already has, with one deliberate
-- difference: `authenticated` gets no DELETE on rsvp_questions. Removing a
-- question is `retired_at`, and the privilege system is what makes that true
-- rather than a habit.

alter table public.rsvp_questions enable row level security;
alter table public.rsvp_questions force row level security;

revoke all on table public.rsvp_questions from public, anon;
grant select, insert, update on table public.rsvp_questions to authenticated;
grant all on table public.rsvp_questions to service_role;

create policy "rsvp_questions: anon has no access"
  on public.rsvp_questions as restrictive to anon
  using (false) with check (false);

create policy "rsvp_questions: owner reads own"
  on public.rsvp_questions for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "rsvp_questions: owner writes own"
  on public.rsvp_questions for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "rsvp_questions: owner updates own"
  on public.rsvp_questions for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));


alter table public.rsvp_answers enable row level security;
alter table public.rsvp_answers force row level security;

revoke all on table public.rsvp_answers from public, anon;
-- SELECT so the buyer can read the replies. DELETE so an erasure request can be
-- honoured. No INSERT and no UPDATE, at either layer: answers arrive through an
-- API route with the service role, and a buyer editing what a guest wrote about
-- their own allergies is not a feature anyone asked for.
grant select, delete on table public.rsvp_answers to authenticated;
grant all on table public.rsvp_answers to service_role;

create policy "rsvp_answers: anon has no access"
  on public.rsvp_answers as restrictive to anon
  using (false) with check (false);

create policy "rsvp_answers: owner reads own"
  on public.rsvp_answers for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "rsvp_answers: owner deletes own"
  on public.rsvp_answers for delete to authenticated
  using (owner_id = (select auth.uid()));


-- The guest page reads its questions as an embedded resource on the event, so
-- PostgREST has to know the new tables exist before the next request rather
-- than after something else happens to make it reload.
notify pgrst, 'reload schema';
