-- Run this in the Supabase SQL Editor after supabase/points.sql.

begin;

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  avatar text,
  avatar_variant text,
  avatar_decoration text,
  profile_banner text,
  status text not null default 'online' check (status in ('online', 'away', 'dnd', 'offline')),
  custom_status text,
  is_galaxy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  handle text;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  handle := nullif(trim(meta->>'username'), '');
  if handle is null then
    handle := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  if handle is null then
    handle := concat('user_', substr(new.id::text, 1, 8));
  end if;

  insert into public.profiles (
    id,
    username,
    display_name,
    avatar,
    avatar_variant,
    avatar_decoration,
    profile_banner,
    status,
    custom_status,
    is_galaxy
  )
  values (
    new.id,
    handle,
    coalesce(nullif(trim(meta->>'displayName'), ''), handle),
    nullif(trim(meta->>'avatar_url'), ''),
    nullif(trim(meta->>'avatarVariant'), ''),
    nullif(trim(meta->>'avatarDecoration'), ''),
    nullif(trim(meta->>'profileBanner'), ''),
    coalesce(nullif(trim(meta->>'status'), ''), 'online'),
    nullif(trim(meta->>'customStatus'), ''),
    coalesce((meta->>'galaxy')::boolean, false)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_profile();

insert into public.profiles (
  id,
  username,
  display_name,
  avatar,
  avatar_variant,
  avatar_decoration,
  profile_banner,
  status,
  custom_status,
  is_galaxy
)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'username'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    concat('user_', substr(u.id::text, 1, 8))
  ) as username,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'displayName'), ''),
    nullif(trim(u.raw_user_meta_data->>'username'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    concat('user_', substr(u.id::text, 1, 8))
  ) as display_name,
  nullif(trim(u.raw_user_meta_data->>'avatar_url'), '') as avatar,
  nullif(trim(u.raw_user_meta_data->>'avatarVariant'), '') as avatar_variant,
  nullif(trim(u.raw_user_meta_data->>'avatarDecoration'), '') as avatar_decoration,
  nullif(trim(u.raw_user_meta_data->>'profileBanner'), '') as profile_banner,
  coalesce(nullif(trim(u.raw_user_meta_data->>'status'), ''), 'online') as status,
  nullif(trim(u.raw_user_meta_data->>'customStatus'), '') as custom_status,
  coalesce((u.raw_user_meta_data->>'galaxy')::boolean, false) as is_galaxy
from auth.users u
on conflict (id) do nothing;

alter table public.profiles enable row level security;

grant select, insert, update on public.profiles to authenticated;

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Profiles are viewable by authenticated users"
on public.profiles
for select
using (auth.role() = 'authenticated');

drop policy if exists "Users can insert their profile" on public.profiles;
create policy "Users can insert their profile"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- Rooms
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  is_private boolean not null default false,
  max_members integer not null default 50,
  theme text not null default 'default',
  tags text[] not null default '{}',
  host_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_rooms_updated_at on public.rooms;
create trigger set_rooms_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

create table if not exists public.room_participants (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_participants_room_last_seen_idx
  on public.room_participants (room_id, last_seen desc);

create index if not exists room_participants_user_idx
  on public.room_participants (user_id);

alter table public.rooms enable row level security;
alter table public.room_participants enable row level security;

grant select, insert, update, delete on public.rooms to authenticated;
grant select, insert, update, delete on public.room_participants to authenticated;

drop policy if exists "Rooms are viewable by authenticated users" on public.rooms;
create policy "Rooms are viewable by authenticated users"
on public.rooms
for select
using (auth.role() = 'authenticated');

drop policy if exists "Users can create rooms" on public.rooms;
create policy "Users can create rooms"
on public.rooms
for insert
with check (auth.uid() = host_id);

drop policy if exists "Hosts can update rooms" on public.rooms;
create policy "Hosts can update rooms"
on public.rooms
for update
using (auth.uid() = host_id)
with check (auth.uid() = host_id);

drop policy if exists "Hosts can delete rooms" on public.rooms;
create policy "Hosts can delete rooms"
on public.rooms
for delete
using (auth.uid() = host_id);

drop policy if exists "Users can view their room memberships" on public.room_participants;
create policy "Users can view their room memberships"
on public.room_participants
for select
using (auth.uid() = user_id);

drop policy if exists "Users can join rooms" on public.room_participants;
create policy "Users can join rooms"
on public.room_participants
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their presence" on public.room_participants;
create policy "Users can update their presence"
on public.room_participants
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can leave rooms" on public.room_participants;
create policy "Users can leave rooms"
on public.room_participants
for delete
using (auth.uid() = user_id);

create or replace function public.join_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row public.rooms;
  active_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into room_row from public.rooms where id = p_room_id;
  if not found then
    raise exception 'room not found';
  end if;

  if room_row.is_private and room_row.host_id <> auth.uid() then
    raise exception 'private room';
  end if;

  select count(*) into active_count
  from public.room_participants
  where room_id = p_room_id
    and last_seen > now() - interval '5 minutes';

  if active_count >= room_row.max_members then
    raise exception 'room full';
  end if;

  insert into public.room_participants (room_id, user_id, joined_at, last_seen)
  values (p_room_id, auth.uid(), now(), now())
  on conflict (room_id, user_id)
  do update set last_seen = excluded.last_seen;
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.room_participants
  where room_id = p_room_id
    and user_id = auth.uid();
end;
$$;

create or replace function public.touch_room_presence(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.room_participants
  set last_seen = now()
  where room_id = p_room_id
    and user_id = auth.uid();
end;
$$;

create or replace function public.get_rooms()
returns table (
  id uuid,
  name text,
  description text,
  category text,
  is_private boolean,
  max_members integer,
  theme text,
  tags text[],
  host_id uuid,
  host_username text,
  host_display_name text,
  host_avatar text,
  active_count integer,
  member_count integer,
  active_sample jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    r.id,
    r.name,
    r.description,
    r.category,
    r.is_private,
    r.max_members,
    r.theme,
    r.tags,
    r.host_id,
    p.username,
    p.display_name,
    p.avatar,
    coalesce(active.active_count, 0)::int as active_count,
    coalesce(members.member_count, 0)::int as member_count,
    coalesce(samples.sample, '[]'::jsonb) as active_sample,
    r.created_at
  from public.rooms r
  left join public.profiles p on p.id = r.host_id
  left join (
    select room_id, count(*) as active_count
    from public.room_participants
    where last_seen > now() - interval '5 minutes'
    group by room_id
  ) active on active.room_id = r.id
  left join (
    select room_id, count(*) as member_count
    from public.room_participants
    group by room_id
  ) members on members.room_id = r.id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', s.user_id,
      'username', s.username,
      'display_name', s.display_name,
      'avatar', s.avatar
    )) as sample
    from (
      select
        rp.user_id,
        p2.username,
        p2.display_name,
        p2.avatar
      from public.room_participants rp
      join public.profiles p2 on p2.id = rp.user_id
      where rp.room_id = r.id
        and rp.last_seen > now() - interval '5 minutes'
      order by rp.last_seen desc
      limit 6
    ) s
  ) samples on true
  order by active_count desc, r.created_at desc;
end;
$$;

revoke all on function public.join_room(uuid) from public;
revoke all on function public.leave_room(uuid) from public;
revoke all on function public.touch_room_presence(uuid) from public;
revoke all on function public.get_rooms() from public;
grant execute on function public.join_room(uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.touch_room_presence(uuid) to authenticated;
grant execute on function public.get_rooms() to authenticated;

-- Direct Messages
create table if not exists public.direct_threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.direct_thread_members (
  thread_id uuid not null references public.direct_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.direct_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists direct_messages_thread_created_idx
  on public.direct_messages (thread_id, created_at desc);

alter table public.direct_threads enable row level security;
alter table public.direct_thread_members enable row level security;
alter table public.direct_messages enable row level security;

grant select on public.direct_threads to authenticated;
grant select, update on public.direct_thread_members to authenticated;
grant select, insert on public.direct_messages to authenticated;

drop policy if exists "Threads visible to members" on public.direct_threads;
create policy "Threads visible to members"
on public.direct_threads
for select
using (
  exists (
    select 1 from public.direct_thread_members m
    where m.thread_id = id and m.user_id = auth.uid()
  )
);

drop policy if exists "Members can view their threads" on public.direct_thread_members;
create policy "Members can view their threads"
on public.direct_thread_members
for select
using (user_id = auth.uid());

drop policy if exists "Members can update read state" on public.direct_thread_members;
create policy "Members can update read state"
on public.direct_thread_members
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Members can view messages" on public.direct_messages;
create policy "Members can view messages"
on public.direct_messages
for select
using (
  exists (
    select 1 from public.direct_thread_members m
    where m.thread_id = direct_messages.thread_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Members can send messages" on public.direct_messages;
create policy "Members can send messages"
on public.direct_messages
for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.direct_thread_members m
    where m.thread_id = direct_messages.thread_id
      and m.user_id = auth.uid()
  )
);

create or replace function public.create_direct_thread(p_target_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  existing_id uuid;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select id into target_id
  from public.profiles
  where lower(username) = lower(trim(p_target_username))
  limit 1;

  if target_id is null then
    raise exception 'user not found';
  end if;

  if target_id = auth.uid() then
    raise exception 'cannot message yourself';
  end if;

  select dt.id into existing_id
  from public.direct_threads dt
  join public.direct_thread_members m1 on m1.thread_id = dt.id and m1.user_id = auth.uid()
  join public.direct_thread_members m2 on m2.thread_id = dt.id and m2.user_id = target_id
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.direct_threads default values
  returning id into new_id;

  insert into public.direct_thread_members (thread_id, user_id)
  values (new_id, auth.uid()), (new_id, target_id);

  return new_id;
end;
$$;

create or replace function public.mark_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.direct_thread_members
  set last_read_at = now()
  where thread_id = p_thread_id
    and user_id = auth.uid();
end;
$$;

create or replace function public.get_direct_threads()
returns table (
  thread_id uuid,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar text,
  other_status text,
  last_message text,
  last_message_at timestamptz,
  unread_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with my_threads as (
    select dtm.thread_id, dtm.last_read_at
    from public.direct_thread_members dtm
    where dtm.user_id = auth.uid()
  ),
  other_members as (
    select m.thread_id, m.user_id
    from public.direct_thread_members m
    join my_threads t on t.thread_id = m.thread_id
    where m.user_id <> auth.uid()
  ),
  last_messages as (
    select
      dm.thread_id,
      dm.content,
      dm.created_at,
      row_number() over (partition by dm.thread_id order by dm.created_at desc) as rn
    from public.direct_messages dm
  )
  select
    t.thread_id,
    o.user_id as other_user_id,
    p.username as other_username,
    p.display_name as other_display_name,
    p.avatar as other_avatar,
    p.status as other_status,
    lm.content as last_message,
    lm.created_at as last_message_at,
    coalesce((
      select count(*)
      from public.direct_messages dm
      where dm.thread_id = t.thread_id
        and dm.sender_id <> auth.uid()
        and (t.last_read_at is null or dm.created_at > t.last_read_at)
    ), 0) as unread_count
  from my_threads t
  join other_members o on o.thread_id = t.thread_id
  left join public.profiles p on p.id = o.user_id
  left join last_messages lm on lm.thread_id = t.thread_id and lm.rn = 1
  order by lm.created_at desc nulls last;
end;
$$;

revoke all on function public.create_direct_thread(text) from public;
revoke all on function public.mark_thread_read(uuid) from public;
revoke all on function public.get_direct_threads() from public;
grant execute on function public.create_direct_thread(text) to authenticated;
grant execute on function public.mark_thread_read(uuid) to authenticated;
grant execute on function public.get_direct_threads() to authenticated;

-- Video matchmaking
create table if not exists public.video_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.video_matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

alter table public.video_queue enable row level security;
alter table public.video_matches enable row level security;

drop policy if exists "No queue access" on public.video_queue;
create policy "No queue access"
on public.video_queue
for all
using (false)
with check (false);

drop policy if exists "No matches access" on public.video_matches;
create policy "No matches access"
on public.video_matches
for all
using (false)
with check (false);

create or replace function public.find_match()
returns table (
  match_id uuid,
  partner_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  partner uuid;
  new_match uuid;
  existing_match_id uuid;
  existing_partner uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select m.id,
         case
           when m.user_a = auth.uid() then m.user_b
           else m.user_a
         end
  into existing_match_id, existing_partner
  from public.video_matches m
  where m.ended_at is null
    and (m.user_a = auth.uid() or m.user_b = auth.uid())
  order by m.created_at desc
  limit 1;

  if existing_match_id is not null then
    delete from public.video_queue
    where user_id = auth.uid();
    match_id := existing_match_id;
    partner_id := existing_partner;
    return next;
  end if;

  delete from public.video_queue
  where updated_at < now() - interval '2 minutes';

  select user_id into partner
  from public.video_queue
  where user_id <> auth.uid()
  order by joined_at
  for update skip locked
  limit 1;

  if partner is null then
    insert into public.video_queue (user_id, joined_at, updated_at)
    values (auth.uid(), now(), now())
    on conflict (user_id)
    do update set updated_at = excluded.updated_at;
    return;
  end if;

  delete from public.video_queue
  where user_id = partner;

  insert into public.video_matches (user_a, user_b)
  values (auth.uid(), partner)
  returning id into new_match;

  match_id := new_match;
  partner_id := partner;
  return next;
end;
$$;

create or replace function public.stop_search()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.video_queue
  where user_id = auth.uid();
end;
$$;

create or replace function public.end_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.video_matches
  set ended_at = now()
  where id = p_match_id
    and (user_a = auth.uid() or user_b = auth.uid());
end;
$$;

revoke all on function public.find_match() from public;
revoke all on function public.stop_search() from public;
revoke all on function public.end_match(uuid) from public;
grant execute on function public.find_match() to authenticated;
grant execute on function public.stop_search() to authenticated;
grant execute on function public.end_match(uuid) to authenticated;

commit;
