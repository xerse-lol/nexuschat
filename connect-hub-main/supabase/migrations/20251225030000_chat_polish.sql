-- DM reactions, moderation reports, read receipts realtime, and attachment hardening.

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

alter table public.direct_message_reactions enable row level security;
grant select, insert, delete on public.direct_message_reactions to authenticated;

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

alter table public.user_reports enable row level security;
alter table public.user_actions enable row level security;

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

revoke all on function public.submit_report(uuid, text, text, text) from public;
grant execute on function public.submit_report(uuid, text, text, text) to authenticated;

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

do $$
begin
  begin
    update storage.buckets
    set public = false
    where id = 'dm-attachments';
  exception
    when insufficient_privilege then
      raise notice 'Skipping storage bucket privacy update (insufficient privilege).';
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
