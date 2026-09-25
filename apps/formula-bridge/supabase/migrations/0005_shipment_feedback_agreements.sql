-- Sample shipment, Japan's feedback, agreement texts and acceptance log.
alter table public.assignments
  add column shipment jsonb not null default '{}'::jsonb,
  add column shipped_at timestamptz,
  add column feedback jsonb not null default '{}'::jsonb,
  add column feedback_at timestamptz;

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
  if new.status not in ('developing','submitted') or old.status = 'draft' then raise exception 'not allowed'; end if;
  if new.status = 'submitted' and old.status <> 'submitted' then new.submitted_at := now(); end if;
  if new.shipped_at is distinct from old.shipped_at then
    if new.status <> 'submitted' then raise exception 'submit before shipping'; end if;
    new.shipped_at := case when new.shipped_at is null then null else now() end;
  end if;
  return new;
end $$;
revoke execute on function public.assignments_guard() from public, anon, authenticated;

create table public.terms (
  doc text not null check (doc in ('nda','purchase','ip')),
  version text not null,
  title_en text not null, title_id text not null, title_ja text not null,
  text_en text not null, text_id text not null, text_ja text not null,
  current boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (doc, version)
);
alter table public.terms enable row level security;
create policy terms_read on public.terms for select to anon, authenticated using (true);
create policy terms_admin on public.terms for all using (public.is_admin()) with check (public.is_admin());

create table public.agreement_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  doc text not null, version text not null,
  accepted_at timestamptz not null default now(),
  user_agent text,
  foreign key (doc, version) references public.terms(doc, version)
);
alter table public.agreement_log enable row level security;
create policy log_read on public.agreement_log for select using (public.is_admin() or user_id = auth.uid());
create policy log_insert on public.agreement_log for insert with check (user_id = auth.uid() and company_id is not distinct from public.my_company());

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); c jsonb := coalesce(m->'company', '{}'::jsonb); cid uuid; k text; v text;
begin
  if exists (select 1 from admin_emails where lower(email) = lower(new.email)) then
    insert into profiles (id, role, email, full_name, title, phone)
    values (new.id, case when new.email_confirmed_at is not null then 'admin' else 'supplier' end, new.email, m->>'full_name', m->>'title', m->>'phone');
  else
    insert into companies (name, address, website, nib, halal, materials, contact_name, contact_email, phone, whatsapp, nda_agreed_at)
    values (coalesce(nullif(c->>'name',''), '(no name)'), c->>'address', c->>'website', c->>'nib', c->>'halal', c->>'materials',
            m->>'full_name', new.email, m->>'phone', m->>'whatsapp',
            case when m->'agreements' ? 'nda' then now() end)
    returning id into cid;
    insert into profiles (id, role, company_id, email, full_name, title, phone, whatsapp)
    values (new.id, 'supplier', cid, new.email, m->>'full_name', m->>'title', m->>'phone', m->>'whatsapp');
    for k, v in select key, value from jsonb_each_text(coalesce(m->'agreements', '{}'::jsonb)) loop
      if exists (select 1 from terms where doc = k and version = v) then
        insert into agreement_log (user_id, company_id, doc, version, user_agent) values (new.id, cid, k, v, left(m->>'user_agent', 300));
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
