-- Suppliers see (and edit) Japan's confidential requests only after accepting the current agreements (NDA etc.).
-- Until now the agreement gate was enforced only in the browser.
create or replace function public.accepted_current_terms() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not exists (
    select 1 from terms t where t.current and not exists (
      select 1 from agreement_log l where l.user_id = auth.uid() and l.doc = t.doc and l.version = t.version));
$$;
revoke execute on function public.accepted_current_terms() from public, anon;
grant execute on function public.accepted_current_terms() to authenticated;

drop policy if exists supplier_read on public.assignments;
create policy supplier_read on public.assignments for select
  using (company_id = public.my_company() and status <> 'draft' and public.accepted_current_terms());
drop policy if exists supplier_update on public.assignments;
create policy supplier_update on public.assignments for update
  using (company_id = public.my_company() and status in ('requested','developing','submitted') and public.accepted_current_terms())
  with check (company_id = public.my_company());
