-- Optional hardening for user_stats and points flow.
-- Run after supabase/points.sql in the Supabase SQL Editor.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_stats_points_nonnegative'
  ) then
    alter table public.user_stats
      add constraint user_stats_points_nonnegative check (points >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_stats_messages_nonnegative'
  ) then
    alter table public.user_stats
      add constraint user_stats_messages_nonnegative check (messages_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_stats_calls_nonnegative'
  ) then
    alter table public.user_stats
      add constraint user_stats_calls_nonnegative check (call_connections >= 0);
  end if;
end;
$$;

revoke insert, update, delete on public.user_stats from anon, authenticated;
grant select on public.user_stats to authenticated;

drop policy if exists "No insert from clients" on public.user_stats;
create policy "No insert from clients"
on public.user_stats
for insert
with check (false);

drop policy if exists "No update from clients" on public.user_stats;
create policy "No update from clients"
on public.user_stats
for update
using (false)
with check (false);

drop policy if exists "No delete from clients" on public.user_stats;
create policy "No delete from clients"
on public.user_stats
for delete
using (false);

commit;
