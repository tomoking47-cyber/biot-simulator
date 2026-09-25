-- Admin rights are granted only after the allow-listed address is confirmed.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); c jsonb := coalesce(m->'company', '{}'::jsonb); cid uuid;
begin
  if exists (select 1 from admin_emails where lower(email) = lower(new.email)) then
    insert into profiles (id, role, email, full_name, title, phone)
    values (new.id, case when new.email_confirmed_at is not null then 'admin' else 'supplier' end, new.email, m->>'full_name', m->>'title', m->>'phone');
  else
    insert into companies (name, address, website, nib, halal, materials, contact_name, contact_email, phone, whatsapp, nda_agreed_at)
    values (coalesce(nullif(c->>'name',''), '(no name)'), c->>'address', c->>'website', c->>'nib', c->>'halal', c->>'materials',
            m->>'full_name', new.email, m->>'phone', m->>'whatsapp',
            case when (m->>'nda')::boolean then now() end)
    returning id into cid;
    insert into profiles (id, role, company_id, email, full_name, title, phone, whatsapp)
    values (new.id, 'supplier', cid, new.email, m->>'full_name', m->>'title', m->>'phone', m->>'whatsapp');
  end if;
  return new;
end $$;

create or replace function public.promote_confirmed_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null
     and exists (select 1 from admin_emails where lower(email) = lower(new.email)) then
    update profiles set role = 'admin' where id = new.id and company_id is null;
  end if;
  return new;
end $$;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
for each row execute function public.promote_confirmed_admin();
revoke execute on function public.promote_confirmed_admin() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
