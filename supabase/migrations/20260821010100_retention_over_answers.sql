-- Retention, over the answer model, and a record that it ran.
--
-- The rule and its dates do not change: a guest's identity leaves this database
-- 30 days after the buyer's grace period ends, and the event is deleted a year
-- after that. What changes is where the identity lives. Until this migration it
-- was four columns on `rsvps`; it is now every `rsvp_answers` row whose
-- `pii_class` is not `none`.
--
-- That is the whole reason `pii_class` exists. The sweep decides what to erase
-- by reading one enum column, never by reading a prompt, so a buyer adding a
-- question the platform has never seen does not add an unswept corner to the
-- database.
--
-- What survives tier 1, unchanged in spirit from before: attendance, party
-- size, created_at, and any answer the buyer classed as holding nothing about a
-- person. That is how a headcount, and "37 people chose the fish", survive
-- redaction while the guests do not stay in a stranger's database.

-- The return type changes from an integer to a summary, so this is a drop and a
-- create rather than a replace. There is one call site, in the sweep below.
drop function public.redact_expired_rsvp_pii(timestamptz);

create or replace function public.redact_expired_rsvp_pii(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answers integer;
  v_replies integer;
begin
  -- Answers first. The envelope's timestamp is what
  -- public.rsvp_answers_before_write refuses to write new personal information
  -- behind, so it has to arrive after the erasure rather than before it.
  update public.rsvp_answers a
     set value_text = case when a.pii_class = 'none' then a.value_text else null end,
         value_choice = case when a.pii_class = 'none' then a.value_choice else null end,
         value_number = case when a.pii_class = 'none' then a.value_number else null end,
         pii_redacted_at = p_now
    from public.events e
   where e.id = a.event_id
     and a.pii_redacted_at is null
     and e.grace_ends_at + interval '30 days' <= p_now;

  get diagnostics v_answers = row_count;

  update public.rsvps r
     set pii_redacted_at = p_now
    from public.events e
   where e.id = r.event_id
     and r.pii_redacted_at is null
     and e.grace_ends_at + interval '30 days' <= p_now;

  get diagnostics v_replies = row_count;

  return jsonb_build_object('replies', v_replies, 'answers', v_answers);
end;
$$;

comment on function public.redact_expired_rsvp_pii(timestamptz) is
  'Tier 1 retention: erases every answer holding personal information 30 days after an event grace period ends, and marks the reply. Answers classed `none` keep their value so the buyer keeps a count. Returns {replies, answers}. Idempotent.';


-- A record that the sweep ran.
--
-- A retention rule nobody scheduled is a paragraph rather than a control, which
-- is why the schedule is asserted in the pgTAP suite. The same is true of a
-- scheduled rule nobody can see the results of: a sweep that has been failing
-- since March looks exactly like a sweep with nothing to do. This is the row
-- that tells them apart, and it is what an alert on a missing day reads.
--
-- It lives in its own schema rather than in `public`, and that is a decision
-- rather than tidiness. Every table in `public` carries `owner_id` and belongs
-- to a tenant, which `01_tenancy.test.sql` asserts over the catalogue rather
-- than over a list of names. A sweep belongs to no tenant, so giving it a
-- nullable owner to satisfy the shape would weaken the invariant for every
-- other table. `platform` is not in the Data API's exposed schemas
-- (supabase/config.toml), so this table has no HTTP surface at all.
create schema if not exists platform;

revoke all on schema platform from public;
revoke usage on schema platform from anon, authenticated;
grant usage on schema platform to service_role;

comment on schema platform is
  'Platform operations data: rows that belong to the operator rather than to a tenant. Not exposed through PostgREST, and no table here carries owner_id because none of them has one.';

create table platform.retention_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  replies_redacted integer not null,
  answers_redacted integer not null,
  events_purged integer not null,

  constraint retention_runs_counts_not_negative
    check (replies_redacted >= 0 and answers_redacted >= 0 and events_purged >= 0)
);

create index retention_runs_ran_at_idx on platform.retention_runs (ran_at desc);

comment on table platform.retention_runs is
  'One row per retention sweep. Holds counts and nothing about any person. A day with no row is the alert.';

revoke all on table platform.retention_runs from public, anon, authenticated;
grant select, insert on table platform.retention_runs to service_role;


-- One entry point for the scheduler, so the order is fixed: redact before
-- purge, report what each did, and record it.
create or replace function public.run_retention_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted jsonb;
  v_purged integer;
begin
  v_redacted := public.redact_expired_rsvp_pii(p_now);
  v_purged := public.purge_expired_events(p_now);

  insert into platform.retention_runs (ran_at, replies_redacted, answers_redacted, events_purged)
  values (
    p_now,
    (v_redacted ->> 'replies')::integer,
    (v_redacted ->> 'answers')::integer,
    v_purged
  );

  return jsonb_build_object(
    'ran_at', p_now,
    'rsvps_redacted', (v_redacted ->> 'replies')::integer,
    'rsvp_answers_redacted', (v_redacted ->> 'answers')::integer,
    'events_purged', v_purged
  );
end;
$$;

comment on function public.run_retention_sweep(timestamptz) is
  'Runs both retention tiers in order, records the run in platform.retention_runs and returns a summary. Scheduled daily; see 20260819010900_schedule_retention.sql.';


revoke execute on function public.redact_expired_rsvp_pii(timestamptz) from public;
revoke execute on function public.run_retention_sweep(timestamptz) from public;
grant execute on function public.redact_expired_rsvp_pii(timestamptz) to service_role;
grant execute on function public.run_retention_sweep(timestamptz) to service_role;

notify pgrst, 'reload schema';
