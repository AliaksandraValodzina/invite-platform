-- The serving state as a computed column on events.
--
-- public.event_state_at already decides what a guest request gets, and it stays
-- the only thing that decides it. This is a wrapper shaped the way PostgREST
-- reads a computed column: a function whose one argument is the table row is
-- selectable as though it were a column, so `select=slug,serving_state` answers
-- "what is this event" and "what should this guest be served" in one read.
--
-- Why one read rather than a second call to rpc/event_state_at. The state is a
-- function of the clock, and the guest page is cached (see docs/serving.md).
-- Two cached reads have two lifetimes, so a page could be rendered from a state
-- that was already a full cache period old, and the wrong serving state would
-- outlive the bound the cache header exists to give it. One read has one clock.
--
-- STABLE rather than IMMUTABLE, because now() is. That is also the strongest
-- volatility PostgREST will expose as a computed column on a GET.

create or replace function public.serving_state(e public.events)
returns public.event_serving_state
language sql
stable
set search_path = ''
as $$
  select public.event_state_at(e.status, e.hosting_expires_at, e.grace_ends_at, now());
$$;

comment on function public.serving_state(public.events) is
  'Computed column. What a guest request for this event should be served, at now(). Read through PostgREST as events.serving_state.';

revoke execute on function public.serving_state(public.events) from public;
grant execute on function public.serving_state(public.events) to authenticated, service_role;

-- PostgREST caches the schema it exposes. Without this, a freshly migrated
-- deployment answers "column serving_state does not exist" until something else
-- happens to make it reload, which is a failure that only shows up after a
-- deploy and looks like a code bug.
notify pgrst, 'reload schema';
