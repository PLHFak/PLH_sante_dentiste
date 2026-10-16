-- Dossier dentaire PLH : schéma, sécurité (RLS) et stockage privé

-- Liste des personnes autorisées (par e-mail)
create table if not exists public.allowed_users (
  email text primary key,
  role text not null default 'owner' check (role in ('owner','reader')),
  added_at timestamptz not null default now()
);

create or replace function public.is_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.allowed_users a
                 where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email','')));
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.allowed_users a
                 where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email',''))
                   and a.role = 'owner');
$$;
revoke all on function public.is_allowed() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_allowed() to authenticated;
grant execute on function public.is_owner() to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

-- Dents (numérotation FDI)
create table if not exists public.teeth (
  fdi text primary key,
  position text,
  category text not null default 'Saine'
    check (category in ('Saine','Obturée','Endo','Implant','Bridge','Alerte','Absente')),
  state text, history text, latest text, reliability text, sources text,
  updated_at timestamptz not null default now()
);

-- Chronologie
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  date_label text not null,
  date_sort date,
  practitioner text, type text, teeth text, description text,
  amount numeric(10,2), status text, source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Documents (radios, factures, devis…) – fichiers dans le bucket privé « dossier »
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  date_label text, doc_date date,
  file_name text not null,
  storage_path text unique,
  type text, content text, origin text,
  teeth text,
  missing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Points à clarifier
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  num int, question text not null, why text, who text,
  resolved boolean not null default false, answer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Notes libres (journal), éventuellement liées à une dent
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  fdi text references public.teeth(fdi) on delete set null,
  body text not null,
  author text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists notes_fdi_idx on public.notes(fdi);

do $$ declare t text; begin
  foreach t in array array['teeth','events','documents','questions'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- RLS : lecture pour les personnes autorisées, écriture pour le propriétaire
do $$ declare t text; begin
  foreach t in array array['teeth','events','documents','questions','notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "lecture autorisée" on public.%I', t);
    execute format('drop policy if exists "écriture propriétaire" on public.%I', t);
    execute format('create policy "lecture autorisée" on public.%I for select to authenticated using ((select public.is_allowed()))', t);
    execute format('create policy "écriture propriétaire" on public.%I for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t);
  end loop;
end $$;

alter table public.allowed_users enable row level security;
drop policy if exists "voir sa ligne" on public.allowed_users;
create policy "voir sa ligne" on public.allowed_users for select to authenticated
  using (lower(email) = lower(coalesce((select auth.jwt()) ->> 'email','')));

-- Temps réel
do $$ declare t text; begin
  foreach t in array array['teeth','events','documents','questions','notes'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- Stockage privé
insert into storage.buckets (id, name, public, file_size_limit)
values ('dossier', 'dossier', false, 52428800)
on conflict (id) do update set public = false;

drop policy if exists "dossier lecture" on storage.objects;
drop policy if exists "dossier ajout" on storage.objects;
drop policy if exists "dossier modif" on storage.objects;
drop policy if exists "dossier suppr" on storage.objects;
create policy "dossier lecture" on storage.objects for select to authenticated
  using (bucket_id = 'dossier' and (select public.is_allowed()));
create policy "dossier ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'dossier' and (select public.is_owner()));
create policy "dossier modif" on storage.objects for update to authenticated
  using (bucket_id = 'dossier' and (select public.is_owner()));
create policy "dossier suppr" on storage.objects for delete to authenticated
  using (bucket_id = 'dossier' and (select public.is_owner()));

insert into public.allowed_users (email, role) values ('p.lhoest@gmail.com','owner')
on conflict (email) do nothing;
