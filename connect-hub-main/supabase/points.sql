-- Run this in the Supabase SQL Editor to enable points and anti-edit controls.

begin;

create table if not exists public.user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points integer not null default 0,
  messages_count integer not null default 0,
  call_connections integer not null default 0,
  last_message_reward_at timestamptz,
  last_call_reward_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_stats_updated_at on public.user_stats;
create trigger set_user_stats_updated_at
before update on public.user_stats
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.user_stats enable row level security;

drop policy if exists "Users can view their stats" on public.user_stats;
create policy "Users can view their stats"
on public.user_stats
for select
using (auth.uid() = user_id);

create or replace function public.award_message_point()
returns public.user_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  stats public.user_stats;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_stats (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  update public.user_stats
  set messages_count = messages_count + 1,
      points = points + 1,
      last_message_reward_at = now()
  where user_id = auth.uid()
    and (
      last_message_reward_at is null
      or now() - last_message_reward_at >= interval '10 seconds'
    )
  returning * into stats;

  if stats.user_id is null then
    select * into stats from public.user_stats where user_id = auth.uid();
  end if;

  return stats;
end;
$$;

create or replace function public.award_call_point()
returns public.user_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  stats public.user_stats;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_stats (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  update public.user_stats
  set call_connections = call_connections + 1,
      points = points + 5,
      last_call_reward_at = now()
  where user_id = auth.uid()
    and (
      last_call_reward_at is null
      or now() - last_call_reward_at >= interval '2 minutes'
    )
  returning * into stats;

  if stats.user_id is null then
    select * into stats from public.user_stats where user_id = auth.uid();
  end if;

  return stats;
end;
$$;

revoke all on function public.award_message_point() from public;
revoke all on function public.award_call_point() from public;
grant execute on function public.award_message_point() to authenticated;
grant execute on function public.award_call_point() to authenticated;

commit;
