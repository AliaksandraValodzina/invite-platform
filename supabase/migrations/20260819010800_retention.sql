-- Retention. What happens to guests' personal information after the party.
--
-- The rule, in one sentence: a guest's identity leaves our database 30 days
-- after the buyer's grace period ends, and the event itself is deleted a year
-- after that.
--
-- Timeline for one event, with the default 12 month tier:
--
--   activation .............. hosting_expires_at = +12 months
--   hosting_expires_at ...... grace_ends_at = +30 days. Page still serves so a
--                             link already in a group chat does not break.
--                             RSVPs closed.
--   grace_ends_at ........... slug serves the designed expiry page. Buyer can
--                             still export their guest list.
--   grace_ends_at + 30d ..... TIER 1. guest_name, guest_email, dietary_notes
--                             and message are erased. attendance, party_size
--                             and created_at survive, so the buyer keeps a
--                             headcount and we keep nothing that identifies
--                             anyone.
--   grace_ends_at + 365d .... TIER 2. The event row is deleted and everything
--                             cascades: content revisions, and the redacted
--                             RSVP rows.
--
-- Why redact rather than delete at tier 1. Deleting outright is the cleanest
-- privacy answer but it destroys the buyer's record of their own event while
-- they may still want it, and buyers do come back asking how many people came.
-- Redaction gives the guest the thing that actually matters to them (they are
-- no longer in a stranger's database) and the buyer the thing that matters to
-- them (a number). Thirty days after the page stops serving is late enough that
-- an export is realistic and early enough that we are not sitting on a list of
-- allergies for a year.
--
-- Why not keep everything. Because "we might want it" is not a retention
-- policy, and dietary notes read together are health and religious information
-- belonging to people who never became our customer.
--
-- These windows are constants in the functions below rather than a settings
-- table on purpose: a retention period that can be changed without a reviewed
-- migration is a retention period nobody can vouch for.
--
-- Out of band, at any time: a guest asking to be erased, or a buyer deleting
-- their account. Both are immediate hard deletes, not a wait for the sweep.
-- See public.erase_rsvp below, and the ON DELETE CASCADE from auth.users.


-- Tier 1.
create or replace function public.redact_expired_rsvp_pii(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.rsvps r
     set guest_name = null,
         guest_email = null,
         dietary_notes = null,
         message = null,
         pii_redacted_at = p_now
    from public.events e
   where e.id = r.event_id
     and r.pii_redacted_at is null
     and e.grace_ends_at + interval '30 days' <= p_now;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.redact_expired_rsvp_pii(timestamptz) is
  'Tier 1 retention: erases identifying RSVP fields 30 days after an event grace period ends. Returns the number of rows redacted. Idempotent.';


-- Tier 2. Deletes the event; content revisions and RSVP rows go with it.
create or replace function public.purge_expired_events(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.events e
   where e.grace_ends_at + interval '365 days' <= p_now;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.purge_expired_events(timestamptz) is
  'Tier 2 retention: deletes events one year after grace ends, cascading content revisions and RSVP rows. Returns the number of events deleted.';


-- Immediate erasure for a guest who asks. Hard delete, no tombstone: the point
-- of the request is that the row stops existing.
create or replace function public.erase_rsvp(p_rsvp_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rsvps r where r.id = p_rsvp_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

comment on function public.erase_rsvp(uuid) is
  'Honours a guest erasure request immediately. Hard delete. Called from an API route with the service role after the requester is verified.';


-- One entry point for the scheduler, so the order is fixed: redact before
-- purge, and report what each did.
create or replace function public.run_retention_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted integer;
  v_purged integer;
begin
  v_redacted := public.redact_expired_rsvp_pii(p_now);
  v_purged := public.purge_expired_events(p_now);

  return jsonb_build_object(
    'ran_at', p_now,
    'rsvps_redacted', v_redacted,
    'events_purged', v_purged
  );
end;
$$;

comment on function public.run_retention_sweep(timestamptz) is
  'Runs both retention tiers in order and returns a summary. Scheduled daily; see 20260819010900_schedule_retention.sql.';


-- These run as the platform, never as a user. `authenticated` cannot call them,
-- and neither can anon.
revoke execute on function public.redact_expired_rsvp_pii(timestamptz) from public;
revoke execute on function public.purge_expired_events(timestamptz) from public;
revoke execute on function public.erase_rsvp(uuid) from public;
revoke execute on function public.run_retention_sweep(timestamptz) from public;

grant execute on function public.redact_expired_rsvp_pii(timestamptz) to service_role;
grant execute on function public.purge_expired_events(timestamptz) to service_role;
grant execute on function public.erase_rsvp(uuid) to service_role;
grant execute on function public.run_retention_sweep(timestamptz) to service_role;
