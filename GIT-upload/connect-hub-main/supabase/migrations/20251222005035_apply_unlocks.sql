-- Run this in the Supabase SQL Editor after supabase/points.sql.


create table if not exists public.user_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('banner', 'decoration')),
  item_id text not null,
  price integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

alter table public.user_unlocks enable row level security;

drop policy if exists "Users can view their unlocks" on public.user_unlocks;
create policy "Users can view their unlocks"
on public.user_unlocks
for select
using (auth.uid() = user_id);

revoke insert, update, delete on public.user_unlocks from anon, authenticated;
grant select on public.user_unlocks to authenticated;

drop policy if exists "No insert from clients" on public.user_unlocks;
create policy "No insert from clients"
on public.user_unlocks
for insert
with check (false);

drop policy if exists "No update from clients" on public.user_unlocks;
create policy "No update from clients"
on public.user_unlocks
for update
using (false)
with check (false);

drop policy if exists "No delete from clients" on public.user_unlocks;
create policy "No delete from clients"
on public.user_unlocks
for delete
using (false);

create or replace function public.hash_seed(seed text)
returns integer
language plpgsql
immutable
as $$
declare
  i integer;
  hash_val bigint := 0;
  code integer;
  mod_base bigint := 4294967296;
begin
  if seed is null then
    return 0;
  end if;

  for i in 1..char_length(seed) loop
    code := ascii(substring(seed from i for 1));
    hash_val := (hash_val * 31 + code);
    hash_val := ((hash_val % mod_base) + mod_base) % mod_base;
    if hash_val >= 2147483648 then
      hash_val := hash_val - mod_base;
    end if;
  end loop;

  if hash_val < 0 then
    hash_val := -hash_val;
  end if;

  return hash_val::integer;
end;
$$;

create or replace function public.style_price(p_item_type text, p_item_id text)
returns integer
language plpgsql
immutable
as $$
declare
  seed text;
  hash_val integer;
  price integer;
begin
  seed := coalesce(p_item_type, '') || ':' || coalesce(p_item_id, '');
  hash_val := public.hash_seed(seed);
  price := 10000 + (hash_val % 181) * 500;
  return price;
end;
$$;

create or replace function public.purchase_style(p_item_type text, p_item_id text)
returns public.user_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  stats public.user_stats;
  price integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_item_type not in ('banner', 'decoration') then
    raise exception 'invalid item type';
  end if;

  if p_item_id is null or length(trim(p_item_id)) = 0 then
    raise exception 'invalid item id';
  end if;

  price := public.style_price(p_item_type, p_item_id);

  insert into public.user_stats (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  if exists (
    select 1 from public.user_unlocks
    where user_id = auth.uid()
      and item_type = p_item_type
      and item_id = p_item_id
  ) then
    select * into stats from public.user_stats where user_id = auth.uid();
    return stats;
  end if;

  update public.user_stats
  set points = points - price
  where user_id = auth.uid()
    and points >= price
  returning * into stats;

  if not found then
    raise exception 'not enough points';
  end if;

  insert into public.user_unlocks (user_id, item_type, item_id, price)
  values (auth.uid(), p_item_type, p_item_id, price)
  on conflict do nothing;

  return stats;
end;
$$;

revoke all on function public.hash_seed(text) from public;
revoke all on function public.style_price(text, text) from public;
revoke all on function public.purchase_style(text, text) from public;
grant execute on function public.purchase_style(text, text) to authenticated;

