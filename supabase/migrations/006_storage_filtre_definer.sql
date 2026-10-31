-- Filtre du stockage indépendant des règles RLS de « documents » (corrige l'accès direct aux fichiers masqués)
create or replace function public.file_hidden_for_me(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.documents d where d.storage_path = p_name
                 and (d.owner_only or (d.has_prices and not public.can_see_prices())));
$$;
revoke all on function public.file_hidden_for_me(text) from public, anon;
grant execute on function public.file_hidden_for_me(text) to authenticated;
alter policy "dossier lecture" on storage.objects
  using (bucket_id = 'dossier' and (select public.is_allowed())
         and ((select public.is_owner()) or not public.file_hidden_for_me(name)));
