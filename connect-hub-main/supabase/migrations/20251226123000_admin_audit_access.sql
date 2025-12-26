-- Allow admins to read audit log entries.
grant select on public.user_actions to authenticated;

drop policy if exists "Admin can view user actions" on public.user_actions;
create policy "Admin can view user actions"
on public.user_actions
for select
using (public.is_admin());

-- Enable realtime for new report notifications.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_reports'
  ) then
    alter publication supabase_realtime add table public.user_reports;
  end if;
end $$;
