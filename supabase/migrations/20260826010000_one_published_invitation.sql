-- One published invitation at a time, per account.
--
-- The captain's decision of 2026-08-24, and until this migration it existed
-- only as a sentence. It has to exist as a rule now, because the same day's
-- other decision opened the copy link: `/t/<templateId>/use` mints a copy for
-- anybody who signs in, so the number of invitations one account can create is
-- deliberately unbounded. This is the only thing standing between one free
-- template and somebody running a wedding business on it, and every published
-- event costs hosting for its whole term.
--
-- Drafts and copies stay unlimited. Nothing here counts them, and that is the
-- shape of the decision rather than an omission: a copy costs nothing until it
-- is in front of guests.
--
-- ## Why a trigger and not a partial unique index
--
--   create unique index ... on public.events (owner_id) where status = 'published'
--
-- is shorter, and it was the first attempt. It says something stronger than the
-- decision does: that no writer anywhere may ever put two published rows on one
-- account, including the platform's own service role. That is not the rule.
-- Seeding a fixture, and a support action putting somebody's second page back
-- up while an order is sorted out, are decisions a person made with the
-- platform's own key; they are not a buyer dodging a limit. The index would
-- also have made `scripts/seed-event.ts` unable to build the four serving-state
-- fixtures the guest page suite is drawn from.
--
-- So the limit is enforced against `authenticated`, which is every path a buyer
-- can reach: the publish button goes through the buyer's own token, and so
-- would a buyer who skipped the button and sent PATCH /events themselves. There
-- is no route by which a buyer holds anything else.
--
-- ## Why the advisory lock
--
-- Two publish presses in two tabs are two transactions. Under READ COMMITTED
-- neither sees the other's uncommitted row, so a bare `exists` check passes in
-- both and the account ends up with two live invitations: exactly the race
-- `public.upload_kind_cap` exists in the database to avoid for uploads. The
-- lock is taken on the OWNER, so it serialises only the presses that could
-- collide, and it is released when the transaction ends whichever way it goes.
create or replace function public.events_publish_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_other_title text;
begin
  -- Only a write that puts a page in front of guests is limited. Taking one
  -- down, renaming one, and saving a date on one that is already up all reach
  -- here and all pass.
  if new.status <> 'published' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'published' then
    return new;
  end if;

  -- The platform, not a buyer. See the header: this is the rule's boundary and
  -- not a hole in it.
  if current_user <> 'authenticated' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.events.published:' || new.owner_id::text, 0)
  );

  select e.title into v_other_title
  from public.events e
  where e.owner_id = new.owner_id
    and e.status = 'published'
    and e.id <> new.id
  limit 1;

  if v_other_title is not null then
    -- The message is read by a person. `src/app/dashboard/[id]/edit/actions.ts`
    -- asks the same question before pressing, so the sentence a buyer normally
    -- sees is written there with the other invitation's name in it; this one is
    -- what is left when two presses race and it still has to make sense.
    raise exception
      'this account already has a published invitation (%), and only one may be published at a time',
      v_other_title
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.events_publish_limit() is
  'One published invitation at a time per account, enforced against authenticated. Drafts and copies are unlimited.';

-- Its own trigger rather than a branch inside `events_before_write`, because
-- that one derives columns and this one refuses a write. A trigger that both
-- fills a row in and rejects it is a trigger nobody can read.
create trigger events_publish_limit
  before insert or update on public.events
  for each row execute function public.events_publish_limit();
