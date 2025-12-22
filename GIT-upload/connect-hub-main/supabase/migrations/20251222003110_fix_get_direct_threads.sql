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
    ), 0)::int as unread_count
  from my_threads t
  join other_members o on o.thread_id = t.thread_id
  left join public.profiles p on p.id = o.user_id
  left join last_messages lm on lm.thread_id = t.thread_id and lm.rn = 1
  order by lm.created_at desc nulls last;
end;
$$;
