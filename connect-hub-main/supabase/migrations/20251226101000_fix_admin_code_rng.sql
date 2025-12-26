-- Fix admin code generator to use pgcrypto in the extensions schema.
create extension if not exists pgcrypto;

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

grant execute on function public.generate_admin_codes(integer, text, integer, text) to authenticated;
