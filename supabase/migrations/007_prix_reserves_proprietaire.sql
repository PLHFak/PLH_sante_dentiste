-- Les montants (devis, offres, factures) ne sont visibles que par le propriétaire.
create or replace function public.can_see_prices()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_owner();
$$;
update public.allowed_users set no_prices = true where role <> 'owner';
