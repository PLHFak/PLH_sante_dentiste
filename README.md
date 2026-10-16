# Dossier dentaire PLH

Site privé (Vercel) + base Supabase temps réel.

- `public/` : le site (HTML/CSS/JS, sans build). `config.js` contient l'URL Supabase et la clé *publishable* (publique par conception).
- `supabase/migrations/` : schéma, règles RLS (accès limité aux e-mails de `allowed_users`), bucket privé `dossier`.
- `supabase/seed.sql` : données initiales (inventaire, chronologie, documents, questions) au 16/10/2026.
- `supabase/functions/seed-upload` + `scripts/seed-storage.mjs` : import ponctuel des radios et archives dans le stockage privé.

Ajouter un lecteur (ex. un dentiste) : `insert into allowed_users (email, role) values ('…', 'reader');`
