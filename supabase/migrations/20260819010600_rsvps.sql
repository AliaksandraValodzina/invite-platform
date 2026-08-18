-- rsvps: guest submissions. This table is the one holding other people's
-- personal information, and none of those people are our customer.
--
-- Collected: attendance, party size, name, email, dietary notes, message.
-- Dietary notes are the sharp edge. "Coeliac", "nut allergy", "no pork" are
-- health and, read together, religious information. That is why every field
-- here has a stated fate at expiry (see 20260819010800_retention.sql) and why
-- the columns below are the whole list.
--
-- Deliberately NOT collected: IP address, user agent, any device or referrer
-- fingerprint. Abuse control on the RSVP endpoint is a rate limit in the API
-- route, which does not need to be written down in a table that outlives the
-- party. Adding any of them later means answering the retention question for
-- them first.

create table public.rsvps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,

  attendance public.rsvp_attendance not null,
  party_size integer not null default 1,

  guest_name text,
  guest_email text,
  dietary_notes text,
  message text,

  pii_redacted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Bounds are a privacy control as much as a validation one: they cap how much
  -- free text a stranger can store about themselves on our disk.
  constraint rsvps_party_size_range
    check (party_size between 0 and 20),
  constraint rsvps_declines_bring_nobody
    check (attendance = 'attending' or party_size = 0),
  constraint rsvps_guest_name_length
    check (guest_name is null or char_length(guest_name) between 1 and 120),
  constraint rsvps_guest_email_normalised
    check (guest_email is null or (
      guest_email = lower(guest_email)
      and char_length(guest_email) <= 254
      and guest_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )),
  constraint rsvps_dietary_notes_length
    check (dietary_notes is null or char_length(dietary_notes) <= 500),
  constraint rsvps_message_length
    check (message is null or char_length(message) <= 2000),

  -- Redaction means something the database enforces, not something a job
  -- claims. Before redaction there is a name; after it, every identifying
  -- column is null and the timestamp says when. A half-redacted row cannot
  -- exist.
  constraint rsvps_redaction_is_complete
    check (case
      when pii_redacted_at is null
        then guest_name is not null
      else
        guest_name is null
        and guest_email is null
        and dietary_notes is null
        and message is null
    end)
);

create index rsvps_event_id_created_at_idx on public.rsvps (event_id, created_at desc);
create index rsvps_owner_id_idx on public.rsvps (owner_id);
-- The retention sweep only ever looks at rows that still hold PII.
create index rsvps_pending_redaction_idx on public.rsvps (event_id) where pii_redacted_at is null;

comment on table public.rsvps is
  'Guest RSVP submissions. Guests PII. Written only through an API route with the service role; see 20260819010800_retention.sql for what happens to each column at expiry.';
comment on column public.rsvps.party_size is
  'Total heads including the person responding, 0 for a decline. sum(party_size) where attendance = attending is therefore the headcount, with no special cases.';
comment on column public.rsvps.dietary_notes is
  'Health and, in aggregate, religious information. Redacted 30 days after grace ends.';
comment on column public.rsvps.pii_redacted_at is
  'When identifying fields were erased. Attendance and party size survive so the buyer keeps a headcount; the guest does not stay in our database.';

create trigger rsvps_set_updated_at
  before update on public.rsvps
  for each row execute function public.set_updated_at();

-- Same denormalisation guard as event_content: the buyer who owns the event
-- owns its RSVPs, and the caller does not get to say so.
create trigger rsvps_set_owner
  before insert or update on public.rsvps
  for each row execute function public.set_owner_from_event();


-- Row level security -------------------------------------------------------

alter table public.rsvps enable row level security;
alter table public.rsvps force row level security;

revoke all on table public.rsvps from public, anon;
-- SELECT so the buyer can see who is coming. DELETE so an erasure request can
-- be honoured. No INSERT and no UPDATE for `authenticated`, at either the
-- privilege or the policy layer: RSVPs arrive through an API route with the
-- service role, and a buyer editing what a guest said about their own allergies
-- is not a feature anyone asked for.
grant select, delete on table public.rsvps to authenticated;
grant all on table public.rsvps to service_role;

create policy "rsvps: anon has no access"
  on public.rsvps as restrictive to anon
  using (false) with check (false);

create policy "rsvps: owner reads own"
  on public.rsvps for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "rsvps: owner deletes own"
  on public.rsvps for delete to authenticated
  using (owner_id = (select auth.uid()));
