-- Accès libre : tout compte dont l'e-mail est vérifié devient « lecteur » automatiquement.
create or replace function public.grant_reader_on_confirm()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    insert into public.allowed_users (email, role) values (lower(new.email), 'reader')
    on conflict (email) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.grant_reader_on_confirm() from public, anon, authenticated;
create trigger on_auth_email_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.grant_reader_on_confirm();

-- Documents réservés au propriétaire (ex. justificatif avec numéro national)
alter table public.documents add column if not exists owner_only boolean not null default false;
update public.documents set owner_only = true where file_name = '2024-05-03_DentalMe_Justificatif.pdf';
alter policy "lecture autorisée" on public.documents
  using ((select public.is_allowed()) and (not owner_only or (select public.is_owner())));
alter policy "dossier lecture" on storage.objects
  using (bucket_id = 'dossier' and (select public.is_allowed())
         and ((select public.is_owner()) or not exists (
              select 1 from public.documents d where d.storage_path = storage.objects.name and d.owner_only)));
