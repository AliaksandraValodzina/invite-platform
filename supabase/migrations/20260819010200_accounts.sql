-- accounts: buyers now, sellers later.
--
-- owner_id is the tenancy key on every table in this schema, and on accounts it
-- points at the row's own auth user. That keeps a single RLS shape everywhere:
-- `owner_id = auth.uid()`. There is deliberately no separate account_id foreign
-- key on the other tables; two columns saying the same thing is two columns
-- that can disagree.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  role public.account_role not null default 'buyer',
  display_name text,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounts_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 120),
  constraint accounts_contact_email_normalised
    check (contact_email is null or (
      contact_email = lower(contact_email)
      and char_length(contact_email) <= 254
      and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ))
);

-- One account per auth user for now. Relaxing this later (an agency holding
-- several shops) is an index drop, which is cheap. The reverse is not.
create unique index accounts_owner_id_key on public.accounts (owner_id);

comment on table public.accounts is
  'A person who bought an invitation. owner_id is the auth user; role is ready for sellers and admins without a schema change.';
comment on column public.accounts.contact_email is
  'Denormalised from auth.users for support and receipts. Nullable because phone signup carries no email.';

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();


-- Role escalation is the classic hole in a table like this. Two independent
-- guards: `authenticated` gets no UPDATE privilege on the role column at all
-- (see the grants below), and this trigger rejects the change even if a future
-- migration hands the privilege back.
create or replace function public.accounts_guard_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'account role can only be changed by the service role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger accounts_guard_role_change
  before update on public.accounts
  for each row execute function public.accounts_guard_role_change();


-- Account rows are created by the platform, never by the client, so that a user
-- cannot mint a second account row for themselves.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (owner_id, contact_email, display_name)
  values (
    new.id,
    lower(nullif(new.email, '')),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    )
  )
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();


-- Row level security -------------------------------------------------------

alter table public.accounts enable row level security;
alter table public.accounts force row level security;

revoke all on table public.accounts from public, anon;
grant select on table public.accounts to authenticated;
-- Column-scoped UPDATE. `role` is absent on purpose; RLS cannot restrict
-- columns, so the privilege system has to.
grant update (display_name, contact_email) on table public.accounts to authenticated;
grant all on table public.accounts to service_role;

create policy "accounts: anon has no access"
  on public.accounts as restrictive to anon
  using (false) with check (false);

create policy "accounts: owner reads own"
  on public.accounts for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "accounts: owner updates own"
  on public.accounts for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- No INSERT or DELETE policy for `authenticated`: creation is the auth.users
-- trigger's job and deletion follows the auth user.
