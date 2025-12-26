-- Fix get_my_ban_status return shape with explicit casts.
drop function if exists public.get_my_ban_status();

create or replace function public.get_my_ban_status()
returns table (
  is_banned boolean,
  reason text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return query
  select
    true::boolean as is_banned,
    b.reason::text,
    b.expires_at::timestamptz
  from public.admin_bans b
  where b.scope = 'user'
    and b.target_user_id = auth.uid()
    and b.revoked_at is null
    and (b.expires_at is null or b.expires_at > now())
  order by b.created_at desc
  limit 1;

  if not found then
    return query select false::boolean, null::text, null::timestamptz;
  end if;
end;
$$;

revoke all on function public.get_my_ban_status() from public;
grant execute on function public.get_my_ban_status() to authenticated;
