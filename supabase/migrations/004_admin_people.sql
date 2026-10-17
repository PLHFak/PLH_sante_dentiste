create or replace function public.admin_people()
returns table (email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz, confirmed boolean, role text, password_set boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'réservé au propriétaire'; end if;
  return query
    select u.email::text, nullif(u.raw_user_meta_data->>'display_name',''), u.created_at, u.last_sign_in_at, (u.email_confirmed_at is not null),
           a.role, coalesce((u.raw_user_meta_data->>'password_set')::boolean, false)
    from auth.users u left join public.allowed_users a on lower(a.email) = lower(u.email)
    order by u.created_at desc;
end $$;
revoke all on function public.admin_people() from public, anon;
grant execute on function public.admin_people() to authenticated;
