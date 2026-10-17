-- Journal d'accès (visites, connexions, inscriptions) + fonctions admin (propriétaire uniquement)
create table if not exists public.access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  event text not null check (event in ('visit','login','login_failed','signup','password_set','admin_open','logout','magic_link')),
  email text check (char_length(email) <= 200),
  user_agent text check (char_length(user_agent) <= 400),
  detail text check (char_length(detail) <= 400)
);
create index if not exists access_log_at_idx on public.access_log(at desc);
alter table public.access_log enable row level security;
create policy "journal ajout" on public.access_log for insert to anon, authenticated
  with check (event in ('visit','login','login_failed','signup','password_set','admin_open','logout','magic_link'));
create policy "journal lecture propriétaire" on public.access_log for select to authenticated
  using ((select public.is_owner()));
alter publication supabase_realtime add table public.access_log;

create or replace function public.admin_users()
returns table (email text, created_at timestamptz, last_sign_in_at timestamptz, confirmed boolean, role text, password_set boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'réservé au propriétaire'; end if;
  return query
    select u.email::text, u.created_at, u.last_sign_in_at, (u.email_confirmed_at is not null),
           a.role, coalesce((u.raw_user_meta_data->>'password_set')::boolean, false)
    from auth.users u left join public.allowed_users a on lower(a.email) = lower(u.email)
    order by u.created_at desc;
end $$;

create or replace function public.admin_set_access(p_email text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'réservé au propriétaire'; end if;
  if lower(p_email) = lower(coalesce(auth.jwt() ->> 'email','')) then raise exception 'impossible de modifier son propre accès'; end if;
  if p_role is null then
    delete from public.allowed_users where lower(email) = lower(p_email);
  elsif p_role in ('reader','owner') then
    insert into public.allowed_users (email, role) values (lower(p_email), p_role)
      on conflict (email) do update set role = excluded.role;
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where lower(email) = lower(p_email);
  else
    raise exception 'rôle inconnu';
  end if;
end $$;

revoke all on function public.admin_users() from public, anon;
revoke all on function public.admin_set_access(text, text) from public, anon;
grant execute on function public.admin_users() to authenticated;
grant execute on function public.admin_set_access(text, text) to authenticated;
