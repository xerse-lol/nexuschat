-- Admin helper to fetch the active match for a user (for spectating).
create or replace function public.admin_get_active_match(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_admin() and auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_target_id is null then
    raise exception 'target required';
  end if;

  select id into v_match_id
  from public.video_matches
  where ended_at is null
    and (user_a = p_target_id or user_b = p_target_id)
  order by created_at desc
  limit 1;

  return v_match_id;
end;
$$;

revoke all on function public.admin_get_active_match(uuid) from public;
grant execute on function public.admin_get_active_match(uuid) to authenticated;
