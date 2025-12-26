-- Admin roles, redeem codes, and moderation actions.

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'owner')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id)
);

create table if not exists public.admin_codes (
  code text primary key,
  role text not null check (role in ('admin', 'owner')),
  max_uses integer not null default 1,
  uses integer not null default 0,
  disabled boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.admin_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.admin_codes(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now()
);

create table if not exists public.admin_bans (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('user', 'ip', 'hwid')),
  target_user_id uuid references auth.users(id) on delete cascade,
  target_value text,
  reason text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists admin_bans_target_user_idx
  on public.admin_bans (target_user_id);

-- Enable realtime for video match moderation updates.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'video_matches'
  ) then
    alter publication supabase_realtime add table public.video_matches;
  end if;
end $$;

alter table public.admin_roles enable row level security;
alter table public.admin_codes enable row level security;
alter table public.admin_code_redemptions enable row level security;
alter table public.admin_bans enable row level security;

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles
    where user_id = auth.uid()
      and role = 'owner'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles
    where user_id = auth.uid()
      and role in ('admin', 'owner')
  );
$$;

create or replace function public.get_my_admin_role()
returns text
language sql
security definer
set search_path = public
as $$
  select role
  from public.admin_roles
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.generate_admin_codes(
  p_count integer,
  p_role text,
  p_max_uses integer default 1,
  p_note text default null
)
returns table (code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_raw text;
  v_code text;
  v_is_service boolean := false;
begin
  v_is_service := auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin');
  if auth.uid() is null and not v_is_service then
    raise exception 'not authenticated';
  end if;
  if not v_is_service and not public.is_owner() then
    raise exception 'not authorized';
  end if;
  if p_role not in ('admin', 'owner') then
    raise exception 'invalid role';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'count must be >= 1';
  end if;

  while v_inserted < p_count loop
    v_raw := upper(encode(gen_random_bytes(6), 'hex'));
    v_code := format('NX-%s-%s-%s', substr(v_raw, 1, 4), substr(v_raw, 5, 4), substr(v_raw, 9, 4));
    begin
      insert into public.admin_codes (code, role, max_uses, note, created_by)
      values (v_code, p_role, coalesce(p_max_uses, 1), p_note, auth.uid());
      v_inserted := v_inserted + 1;
      code := v_code;
      return next;
    exception
      when unique_violation then
        -- retry
    end;
  end loop;
end;
$$;

create or replace function public.redeem_admin_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_role text;
  v_current text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_code := upper(trim(coalesce(p_code, '')));
  if v_code = '' then
    raise exception 'invalid code';
  end if;

  select role into v_role
  from public.admin_codes
  where code = v_code
    and disabled = false
    and uses < max_uses
  limit 1;

  if v_role is null then
    raise exception 'code not found or exhausted';
  end if;

  select role into v_current
  from public.admin_roles
  where user_id = auth.uid()
  limit 1;

  if v_current is not null then
    if v_current = 'owner' then
      return v_current;
    end if;
    if v_current = 'admin' and v_role = 'owner' then
      update public.admin_roles
      set role = 'owner',
          granted_at = now(),
          granted_by = auth.uid()
      where user_id = auth.uid();
    else
      return v_current;
    end if;
  else
    insert into public.admin_roles (user_id, role, granted_by)
    values (auth.uid(), v_role, auth.uid());
  end if;

  update public.admin_codes
  set uses = uses + 1
  where code = v_code;

  insert into public.admin_code_redemptions (code, user_id)
  values (v_code, auth.uid());

  return v_role;
end;
$$;

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
    true as is_banned,
    b.reason,
    b.expires_at
  from public.admin_bans b
  where b.scope = 'user'
    and b.target_user_id = auth.uid()
    and b.revoked_at is null
    and (b.expires_at is null or b.expires_at > now())
  order by b.created_at desc
  limit 1;

  if not found then
    return query select false, null, null;
  end if;
end;
$$;

create or replace function public.admin_ban_user(
  p_target_id uuid,
  p_reason text,
  p_duration_seconds integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
  v_ban_id uuid;
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
  if p_target_id = auth.uid() then
    raise exception 'cannot ban yourself';
  end if;

  update public.admin_bans
  set revoked_at = now()
  where scope = 'user'
    and target_user_id = p_target_id
    and revoked_at is null;

  if p_duration_seconds is not null and p_duration_seconds > 0 then
    v_expires := now() + make_interval(secs => p_duration_seconds);
  else
    v_expires := null;
  end if;

  insert into public.admin_bans (scope, target_user_id, reason, created_by, expires_at)
  values ('user', p_target_id, nullif(trim(p_reason), ''), auth.uid(), v_expires)
  returning id into v_ban_id;

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    p_target_id,
    'admin_ban',
    jsonb_build_object('reason', nullif(trim(p_reason), ''), 'expires_at', v_expires)
  );

  return v_ban_id;
end;
$$;

create or replace function public.admin_unban_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_admin() and auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;

  update public.admin_bans
  set revoked_at = now()
  where scope = 'user'
    and target_user_id = p_target_id
    and revoked_at is null;

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    p_target_id,
    'admin_unban',
    null
  );
end;
$$;

create or replace function public.admin_end_match_for_user(p_target_id uuid)
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

  select id into v_match_id
  from public.video_matches
  where ended_at is null
    and (user_a = p_target_id or user_b = p_target_id)
  order by created_at desc
  limit 1;

  if v_match_id is null then
    return null;
  end if;

  update public.video_matches
  set ended_at = now()
  where id = v_match_id;

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    p_target_id,
    'admin_end_match',
    jsonb_build_object('match_id', v_match_id)
  );

  return v_match_id;
end;
$$;

grant select on public.video_matches to authenticated;

drop policy if exists "Video matches visible to participants" on public.video_matches;
create policy "Video matches visible to participants"
on public.video_matches
for select
using (auth.uid() = user_a or auth.uid() = user_b);

grant select on public.admin_roles to authenticated;
grant select, insert, update, delete on public.admin_codes to authenticated;
grant select, insert on public.admin_code_redemptions to authenticated;
grant select, insert, update on public.admin_bans to authenticated;
grant select on public.user_reports to authenticated;

drop policy if exists "Admin roles visible to authenticated users" on public.admin_roles;
create policy "Admin roles visible to authenticated users"
on public.admin_roles
for select
using (auth.role() = 'authenticated');

drop policy if exists "Owner manages admin roles" on public.admin_roles;
create policy "Owner manages admin roles"
on public.admin_roles
for all
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "Owner can manage admin codes" on public.admin_codes;
create policy "Owner can manage admin codes"
on public.admin_codes
for all
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "Owner can view redemptions" on public.admin_code_redemptions;
create policy "Owner can view redemptions"
on public.admin_code_redemptions
for select
using (public.is_owner());

drop policy if exists "Admin can view bans" on public.admin_bans;
create policy "Admin can view bans"
on public.admin_bans
for select
using (public.is_admin());

drop policy if exists "Admin can manage bans" on public.admin_bans;
create policy "Admin can manage bans"
on public.admin_bans
for insert
with check (public.is_admin());

drop policy if exists "Admin can update bans" on public.admin_bans;
create policy "Admin can update bans"
on public.admin_bans
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admin can view reports" on public.user_reports;
create policy "Admin can view reports"
on public.user_reports
for select
using (public.is_admin());

revoke all on function public.is_owner() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.get_my_admin_role() from public;
revoke all on function public.generate_admin_codes(integer, text, integer, text) from public;
revoke all on function public.redeem_admin_code(text) from public;
revoke all on function public.get_my_ban_status() from public;
revoke all on function public.admin_ban_user(uuid, text, integer) from public;
revoke all on function public.admin_unban_user(uuid) from public;
revoke all on function public.admin_end_match_for_user(uuid) from public;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_my_admin_role() to authenticated;
grant execute on function public.generate_admin_codes(integer, text, integer, text) to authenticated;
grant execute on function public.redeem_admin_code(text) to authenticated;
grant execute on function public.get_my_ban_status() to authenticated;
grant execute on function public.admin_ban_user(uuid, text, integer) to authenticated;
grant execute on function public.admin_unban_user(uuid) to authenticated;
grant execute on function public.admin_end_match_for_user(uuid) to authenticated;
