-- Schedules the retention sweep.
--
-- This is a separate migration from the functions because it is the one that
-- turns a written policy into a thing that actually happens. A retention rule
-- nobody scheduled is a paragraph in a privacy policy, not a control.
--
-- The extension is created unconditionally rather than behind an "if
-- pg_available_extensions says so" guard. A guard would let this migration
-- silently no-op on an environment without pg_cron, and the failure mode of
-- that is guest PII quietly retained forever with a green migration log. If an
-- environment cannot schedule this, that should stop a deploy and get a human
-- to decide, not pass.
--
-- pg_cron is available on every Supabase project and in the local CLI image.

create extension if not exists pg_cron;

-- Named job, unscheduled first, so re-running this migration against a database
-- that already has it does not accumulate duplicates.
select cron.unschedule('retention-sweep')
 where exists (select 1 from cron.job where jobname = 'retention-sweep');

-- 03:17 UTC daily. Off-peak, and not on the hour, where every other scheduled
-- job in the world is.
select cron.schedule(
  'retention-sweep',
  '17 3 * * *',
  $$select public.run_retention_sweep()$$
);

comment on extension pg_cron is
  'Runs public.run_retention_sweep daily. See docs/data-model.md for the retention rule it enforces.';
