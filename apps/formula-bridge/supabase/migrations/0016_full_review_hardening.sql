-- Full line-by-line review (2026-09-26).

-- 1. Files: suppliers reach their own company's folder only after accepting the current agreements, and cannot
--    add or delete files of a submission that Japan has adopted in a finalized formula (evidence).
create or replace function public.attachment_locked(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from finals f where f.finalized_at is not null and f.adopted_assignment::text = (storage.foldername(p_name))[2]);
$$;
revoke execute on function public.attachment_locked(text) from public, anon;
grant execute on function public.attachment_locked(text) to authenticated;

drop policy if exists attach_read on storage.objects;
drop policy if exists attach_insert on storage.objects;
drop policy if exists attach_delete on storage.objects;
create policy attach_read on storage.objects for select
  using (bucket_id = 'attachments' and (public.is_admin() or ((storage.foldername(name))[1] = public.my_company()::text and public.accepted_current_terms())));
create policy attach_insert on storage.objects for insert
  with check (bucket_id = 'attachments' and (public.is_admin() or ((storage.foldername(name))[1] = public.my_company()::text and public.accepted_current_terms() and not public.attachment_locked(name))));
create policy attach_delete on storage.objects for delete
  using (bucket_id = 'attachments' and (public.is_admin() or ((storage.foldername(name))[1] = public.my_company()::text and public.accepted_current_terms() and not public.attachment_locked(name))));

-- 2. An agreement text that somebody has accepted can no longer be changed (only "current" can be switched).
create or replace function public.terms_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.title_en, new.title_id, new.title_ja, new.text_en, new.text_id, new.text_ja, new.doc, new.version)
     is distinct from (old.title_en, old.title_id, old.title_ja, old.text_en, old.text_id, old.text_ja, old.doc, old.version)
     and exists (select 1 from agreement_log l where l.doc = old.doc and l.version = old.version) then
    raise exception 'this version has been accepted and cannot be changed; register a new version';
  end if;
  return new;
end $$;
revoke execute on function public.terms_guard() from public, anon, authenticated;
drop trigger if exists terms_guard on public.terms;
create trigger terms_guard before update on public.terms for each row execute function public.terms_guard();

-- 3. Acceptance records stay when a user account is deleted (with the e-mail address kept for identification).
alter table public.agreement_log add column if not exists email text;
alter table public.agreement_log alter column user_id drop not null;
alter table public.agreement_log drop constraint if exists agreement_log_user_id_fkey;
alter table public.agreement_log add constraint agreement_log_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
create or replace function public.agreement_log_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.accepted_at := now();
  new.email := (select email from auth.users where id = new.user_id);
  if not exists (select 1 from terms where doc = new.doc and version = new.version and current) then
    raise exception 'not the current version';
  end if;
  return new;
end $$;
revoke execute on function public.agreement_log_guard() from public, anon, authenticated;
update public.agreement_log l set email = u.email from auth.users u where u.id = l.user_id and l.email is null;

-- 4. Suppliers cannot set the submission time themselves in any status.
create or replace function public.assignments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_admin() or auth.uid() is null then return new; end if;
  if new.project_id <> old.project_id or new.company_id <> old.company_id
     or new.request_snapshot <> old.request_snapshot or new.requested_at is distinct from old.requested_at
     or new.feedback <> old.feedback or new.feedback_at is distinct from old.feedback_at then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from finals where adopted_assignment = old.id and finalized_at is not null) then
    raise exception 'adopted formula is locked';
  end if;
  if new.status not in ('developing','submitted') or old.status = 'draft' then raise exception 'not allowed'; end if;
  if new.status = 'submitted' and old.status <> 'submitted' then new.submitted_at := now();
  else new.submitted_at := old.submitted_at; end if;
  if new.shipped_at is distinct from old.shipped_at then
    if new.status <> 'submitted' then raise exception 'submit before shipping'; end if;
    new.shipped_at := case when new.shipped_at is null then null else now() end;
  end if;
  return new;
end $$;
revoke execute on function public.assignments_guard() from public, anon, authenticated;

-- 5. Reissuing a temporary password ends the supplier's existing sessions (used by create-supplier, service role only).
create or replace function public.revoke_user_sessions(p_user uuid) returns void
language sql security definer set search_path = public, auth as $$
  delete from auth.sessions where user_id = p_user;
$$;
revoke execute on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
