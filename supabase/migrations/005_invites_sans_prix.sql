-- Invités « sans prix » + documents contenant des montants + compte invité par code (créé via SQL, non versionné ici)
alter table public.allowed_users add column if not exists no_prices boolean not null default false;
alter table public.documents add column if not exists has_prices boolean not null default false;
create or replace function public.can_see_prices()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.allowed_users a
                     where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email','')) and a.no_prices);
$$;
revoke all on function public.can_see_prices() from public, anon;
grant execute on function public.can_see_prices() to authenticated;
alter policy "lecture autorisée" on public.documents
  using ((select public.is_allowed()) and (not owner_only or (select public.is_owner()))
         and (not has_prices or (select public.can_see_prices())));
