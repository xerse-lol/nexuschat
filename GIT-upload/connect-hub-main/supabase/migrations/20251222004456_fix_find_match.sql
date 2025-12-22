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
    delete from public.video_queue
    where user_id = auth.uid();
    match_id := existing_match;
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
