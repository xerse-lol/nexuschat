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
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.direct_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists direct_messages_thread_created_idx
  on public.direct_messages (thread_id, created_at desc);

create table if not exists public.direct_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists direct_message_reactions_message_idx
  on public.direct_message_reactions (message_id);

do $$
begin
  begin
    insert into storage.buckets (id, name, public)
    values ('dm-attachments', 'dm-attachments', true)
    on conflict (id) do nothing;
    update storage.buckets
    set public = false
    where id = 'dm-attachments';
  exception
    when insufficient_privilege then
      raise notice 'Skipping storage bucket insert (insufficient privilege).';
  end;

  begin
    execute 'drop policy if exists "DM attachments read" on storage.objects';
    execute 'create policy "DM attachments read" on storage.objects for select using (bucket_id = ''dm-attachments'' and exists (select 1 from public.direct_thread_members m where m.thread_id::text = split_part(name, ''/'', 2) and m.user_id = auth.uid()))';
    execute 'drop policy if exists "DM attachments insert" on storage.objects';
    execute 'create policy "DM attachments insert" on storage.objects for insert with check (bucket_id = ''dm-attachments'' and auth.role() = ''authenticated'' and exists (select 1 from public.direct_thread_members m where m.thread_id::text = split_part(name, ''/'', 2) and m.user_id = auth.uid()))';
    execute 'drop policy if exists "DM attachments delete" on storage.objects';
    execute 'create policy "DM attachments delete" on storage.objects for delete using (bucket_id = ''dm-attachments'' and auth.uid() = owner)';
  exception
    when insufficient_privilege then
      raise notice 'Skipping storage policies (insufficient privilege). Create policies in Supabase dashboard.';
  end;
end $$;

-- Enable realtime for direct messages.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;

-- Enable realtime for reactions + read receipts.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_message_reactions'
  ) then
    alter publication supabase_realtime add table public.direct_message_reactions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_thread_members'
  ) then
    alter publication supabase_realtime add table public.direct_thread_members;
  end if;
end $$;

alter table public.direct_threads enable row level security;
alter table public.direct_thread_members enable row level security;
alter table public.direct_messages enable row level security;
alter table public.direct_message_reactions enable row level security;

grant select on public.direct_threads to authenticated;
grant select, update on public.direct_thread_members to authenticated;
grant select, insert on public.direct_messages to authenticated;
grant select, insert, delete on public.direct_message_reactions to authenticated;

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

drop policy if exists "Reactions visible to thread members" on public.direct_message_reactions;
create policy "Reactions visible to thread members"
on public.direct_message_reactions
for select
using (
  exists (
    select 1
    from public.direct_messages dm
    join public.direct_thread_members m on m.thread_id = dm.thread_id
    where dm.id = direct_message_reactions.message_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Members can react" on public.direct_message_reactions;
create policy "Members can react"
on public.direct_message_reactions
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.direct_messages dm
    join public.direct_thread_members m on m.thread_id = dm.thread_id
    where dm.id = direct_message_reactions.message_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Members can remove their reactions" on public.direct_message_reactions;
create policy "Members can remove their reactions"
on public.direct_message_reactions
for delete
using (user_id = auth.uid());

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

  if exists (
    select 1
    from public.blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = target_id)
       or (b.blocker_id = target_id and b.blocked_id = auth.uid())
  ) then
    raise exception 'cannot message this user';
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

drop function if exists public.get_direct_threads();
drop function if exists public.get_direct_threads();
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
  unread_count integer,
  is_hidden boolean,
  is_friend boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with my_threads as (
    select m.thread_id, m.last_read_at, m.is_hidden
    from public.direct_thread_members m
    where m.user_id = auth.uid()
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
      dm.attachments,
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
    case
      when lm.content is not null and btrim(lm.content) <> '' then lm.content
      when lm.attachments is not null and jsonb_array_length(lm.attachments) > 0 then '[Attachment]'
      else null
    end as last_message,
    lm.created_at as last_message_at,
    coalesce((
      select count(*)
      from public.direct_messages dm
      where dm.thread_id = t.thread_id
        and dm.sender_id <> auth.uid()
        and (t.last_read_at is null or dm.created_at > t.last_read_at)
    ), 0)::int as unread_count,
    t.is_hidden as is_hidden,
    exists (
      select 1
      from public.friendships f
      where f.user_a = least(auth.uid(), o.user_id)
        and f.user_b = greatest(auth.uid(), o.user_id)
    ) as is_friend
  from my_threads t
  join other_members o on o.thread_id = t.thread_id
  left join public.profiles p on p.id = o.user_id
  left join last_messages lm on lm.thread_id = t.thread_id and lm.rn = 1
  where not exists (
    select 1
    from public.blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = o.user_id)
       or (b.blocker_id = o.user_id and b.blocked_id = auth.uid())
  )
  order by lm.created_at desc nulls last;
end;
$$;

revoke all on function public.create_direct_thread(text) from public;
revoke all on function public.mark_thread_read(uuid) from public;
revoke all on function public.get_direct_threads() from public;
grant execute on function public.create_direct_thread(text) to authenticated;
grant execute on function public.mark_thread_read(uuid) to authenticated;
grant execute on function public.get_direct_threads() to authenticated;

-- Friend requests, friendships, and blocks
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);

-- Enable realtime for friend requests.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friend_requests'
  ) then
    alter publication supabase_realtime add table public.friend_requests;
  end if;
end $$;

create table if not exists public.friendships (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a <> user_b)
);

create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  context text not null default 'direct_messages',
  reason text not null,
  details text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
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
  and not exists (
    select 1
    from public.direct_thread_members m
    join public.blocked_users b
      on (b.blocker_id = auth.uid() and b.blocked_id = m.user_id)
      or (b.blocker_id = m.user_id and b.blocked_id = auth.uid())
    where m.thread_id = direct_messages.thread_id
      and m.user_id <> auth.uid()
  )
);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.blocked_users enable row level security;
alter table public.user_reports enable row level security;
alter table public.user_actions enable row level security;

grant select, insert, delete on public.friend_requests to authenticated;
grant select, delete on public.friendships to authenticated;
grant select, insert, delete on public.blocked_users to authenticated;
grant insert on public.user_reports to authenticated;

drop policy if exists "Reports insert by reporter" on public.user_reports;
create policy "Reports insert by reporter"
on public.user_reports
for insert
with check (reporter_id = auth.uid());

drop policy if exists "No user actions access" on public.user_actions;
create policy "No user actions access"
on public.user_actions
for all
using (false)
with check (false);

drop policy if exists "Friend requests visible to participants" on public.friend_requests;
create policy "Friend requests visible to participants"
on public.friend_requests
for select
using (requester_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "Users can send friend requests" on public.friend_requests;
create policy "Users can send friend requests"
on public.friend_requests
for insert
with check (requester_id = auth.uid());

drop policy if exists "Users can remove their friend requests" on public.friend_requests;
create policy "Users can remove their friend requests"
on public.friend_requests
for delete
using (requester_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "Friendships visible to members" on public.friendships;
create policy "Friendships visible to members"
on public.friendships
for select
using (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists "Members can remove friendships" on public.friendships;
create policy "Members can remove friendships"
on public.friendships
for delete
using (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists "Blocks visible to blocker" on public.blocked_users;
create policy "Blocks visible to blocker"
on public.blocked_users
for select
using (blocker_id = auth.uid());

drop policy if exists "Users can block others" on public.blocked_users;
create policy "Users can block others"
on public.blocked_users
for insert
with check (blocker_id = auth.uid());

drop policy if exists "Users can unblock others" on public.blocked_users;
create policy "Users can unblock others"
on public.blocked_users
for delete
using (blocker_id = auth.uid());

create or replace function public.submit_report(
  p_target_id uuid,
  p_reason text,
  p_details text default null,
  p_context text default 'direct_messages'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  report_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_target_id is null then
    raise exception 'target required';
  end if;

  insert into public.user_reports (reporter_id, target_id, context, reason, details)
  values (auth.uid(), p_target_id, coalesce(nullif(trim(p_context), ''), 'direct_messages'), trim(p_reason), nullif(trim(p_details), ''))
  returning id into report_id;

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    p_target_id,
    'report_user',
    jsonb_build_object('context', coalesce(nullif(trim(p_context), ''), 'direct_messages'), 'reason', trim(p_reason))
  );

  return report_id;
end;
$$;

create or replace function public.send_friend_request(p_target_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  request_id uuid;
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
    raise exception 'cannot add yourself';
  end if;

  if exists (
    select 1
    from public.blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = target_id)
       or (b.blocker_id = target_id and b.blocked_id = auth.uid())
  ) then
    raise exception 'blocked';
  end if;

  if exists (
    select 1
    from public.friendships f
    where f.user_a = least(auth.uid(), target_id)
      and f.user_b = greatest(auth.uid(), target_id)
  ) then
    raise exception 'already friends';
  end if;

  insert into public.friend_requests (requester_id, recipient_id)
  values (auth.uid(), target_id)
  on conflict (requester_id, recipient_id) do update
    set created_at = excluded.created_at
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.accept_friend_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select requester_id into requester
  from public.friend_requests
  where id = p_request_id
    and recipient_id = auth.uid();

  if requester is null then
    raise exception 'request not found';
  end if;

  insert into public.friendships (user_a, user_b)
  values (least(auth.uid(), requester), greatest(auth.uid(), requester))
  on conflict (user_a, user_b) do nothing;

  delete from public.friend_requests
  where id = p_request_id;

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    requester,
    'accept_friend_request',
    jsonb_build_object('request_id', p_request_id)
  );

  return requester;
end;
$$;

create or replace function public.decline_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.friend_requests
  where id = p_request_id
    and recipient_id = auth.uid();
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.friend_requests
  where id = p_request_id
    and requester_id = auth.uid();
end;
$$;

create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.friendships
  where user_a = least(auth.uid(), p_friend_id)
    and user_b = greatest(auth.uid(), p_friend_id);

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    p_friend_id,
    'remove_friend',
    null
  );
end;
$$;

create or replace function public.block_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_target_id = auth.uid() then
    raise exception 'cannot block yourself';
  end if;

  insert into public.blocked_users (blocker_id, blocked_id)
  values (auth.uid(), p_target_id)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.friend_requests
  where (requester_id = auth.uid() and recipient_id = p_target_id)
     or (requester_id = p_target_id and recipient_id = auth.uid());

  delete from public.friendships
  where user_a = least(auth.uid(), p_target_id)
    and user_b = greatest(auth.uid(), p_target_id);

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    p_target_id,
    'block_user',
    null
  );
end;
$$;

create or replace function public.unblock_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.blocked_users
  where blocker_id = auth.uid()
    and blocked_id = p_target_id;

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    p_target_id,
    'unblock_user',
    null
  );
end;
$$;

create or replace function public.set_thread_hidden(p_thread_id uuid, p_hidden boolean)
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
  set is_hidden = p_hidden
  where thread_id = p_thread_id
    and user_id = auth.uid();

  insert into public.user_actions (actor_id, target_id, action, details)
  values (
    auth.uid(),
    null,
    case when p_hidden then 'ignore_thread' else 'unignore_thread' end,
    jsonb_build_object('thread_id', p_thread_id, 'hidden', p_hidden)
  );
end;
$$;

create or replace function public.get_friend_requests()
returns table (
  request_id uuid,
  requester_id uuid,
  requester_username text,
  requester_display_name text,
  requester_avatar text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    fr.id as request_id,
    fr.requester_id,
    p.username as requester_username,
    p.display_name as requester_display_name,
    p.avatar as requester_avatar,
    fr.created_at
  from public.friend_requests fr
  join public.profiles p on p.id = fr.requester_id
  where fr.recipient_id = auth.uid()
  order by fr.created_at desc;
end;
$$;

revoke all on function public.send_friend_request(text) from public;
revoke all on function public.submit_report(uuid, text, text, text) from public;
revoke all on function public.accept_friend_request(uuid) from public;
revoke all on function public.decline_friend_request(uuid) from public;
revoke all on function public.cancel_friend_request(uuid) from public;
revoke all on function public.remove_friend(uuid) from public;
revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.set_thread_hidden(uuid, boolean) from public;
revoke all on function public.get_friend_requests() from public;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.submit_report(uuid, text, text, text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.set_thread_hidden(uuid, boolean) to authenticated;
grant execute on function public.get_friend_requests() to authenticated;

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
  existing_match uuid;
  existing_partner uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select
    vm.id,
    case when vm.user_a = auth.uid() then vm.user_b else vm.user_a end
  into existing_match, existing_partner
  from public.video_matches vm
  where vm.ended_at is null
    and (vm.user_a = auth.uid() or vm.user_b = auth.uid())
  order by vm.created_at desc
  limit 1;

  if existing_match is not null then
    if existing_partner is null or existing_partner = auth.uid() then
      update public.video_matches
      set ended_at = now()
      where id = existing_match;
    else
      delete from public.video_queue
      where user_id = auth.uid();
      match_id := existing_match;
      partner_id := existing_partner;
      return next;
      return;
    end if;
  end if;

  delete from public.video_queue
  where updated_at < now() - interval '2 minutes';

  select user_id into partner
  from public.video_queue
  where user_id <> auth.uid()
    and not exists (
      select 1
      from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = user_id)
         or (b.blocker_id = user_id and b.blocked_id = auth.uid())
    )
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

grant select on public.video_matches to authenticated;

drop policy if exists "Video matches visible to participants" on public.video_matches;
create policy "Video matches visible to participants"
on public.video_matches
for select
using (auth.uid() = user_a or auth.uid() = user_b);

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
  set search_path = public, extensions
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
      v_raw := upper(encode(extensions.gen_random_bytes(6), 'hex'));
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

grant select on public.user_actions to authenticated;

drop policy if exists "Admin can view user actions" on public.user_actions;
create policy "Admin can view user actions"
on public.user_actions
for select
using (public.is_admin());

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

commit;
