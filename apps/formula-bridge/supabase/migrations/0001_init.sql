-- Formula Bridge: schema, row level security, storage.
-- Suppliers only ever see their own company's assignments; everything else is admin-only.

create extension if not exists pgcrypto;

create table public.admin_emails (email text primary key);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text, website text, nib text, halal text, materials text,
  contact_name text, contact_email text, phone text, whatsapp text,
  nda_agreed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'supplier' check (role in ('admin','supplier')),
  company_id uuid references public.companies(id) on delete set null,
  email text, full_name text, title text, phone text, whatsapp text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null default '新規案件',
  request jsonb not null default '{}'::jsonb,
  brief jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','requested','developing','submitted')),
  request_snapshot jsonb not null default '{}'::jsonb,  -- what the supplier may read: brief + target costs
  supplier jsonb not null default '{}'::jsonb,          -- what the supplier writes
  requested_at timestamptz, submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (project_id, company_id)
);

create table public.finals (
  project_id uuid primary key references public.projects(id) on delete cascade,
  adopted_assignment uuid references public.assignments(id) on delete set null,
  base_formula jsonb not null default '[]'::jsonb,
  additions jsonb not null default '[]'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  sup_ja text,
  finalized_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.plans (
  project_id uuid primary key references public.projects(id) on delete cascade,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

create table public.market (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table public.settings (key text primary key, value text);
create table public.mail_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text, to_email text, subject text, ok boolean, detail text
);

-- Helpers (security definer so policies can read profiles without recursion)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid();
$$;

-- New sign-ups: admins by allow-list, everyone else registers a supplier company.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); c jsonb := coalesce(m->'company', '{}'::jsonb); cid uuid;
begin
  if exists (select 1 from admin_emails where lower(email) = lower(new.email)) then
    insert into profiles (id, role, email, full_name, title, phone)
    values (new.id, 'admin', new.email, m->>'full_name', m->>'title', m->>'phone');
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
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Suppliers may only fill in their part of an assignment and move it forward.
create or replace function public.assignments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_admin() or auth.uid() is null then return new; end if;
  if new.project_id <> old.project_id or new.company_id <> old.company_id
     or new.request_snapshot <> old.request_snapshot or new.requested_at is distinct from old.requested_at then
    raise exception 'not allowed';
  end if;
  if new.status not in ('developing','submitted') or old.status = 'draft' then raise exception 'not allowed'; end if;
  if new.status = 'submitted' and old.status <> 'submitted' then new.submitted_at := now(); end if;
  return new;
end $$;
create trigger assignments_guard before update on public.assignments for each row execute function public.assignments_guard();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger finals_touch before update on public.finals for each row execute function public.touch_updated_at();

-- Row level security
alter table public.admin_emails enable row level security;
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.assignments enable row level security;
alter table public.finals enable row level security;
alter table public.plans enable row level security;
alter table public.market enable row level security;
alter table public.settings enable row level security;
alter table public.mail_log enable row level security;

create policy admin_all on public.admin_emails for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.projects for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.finals for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.plans for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.market for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.settings for all using (public.is_admin()) with check (public.is_admin());
create policy admin_read on public.mail_log for select using (public.is_admin());

create policy read_own_or_admin on public.companies for select using (public.is_admin() or id = public.my_company());
create policy update_own_or_admin on public.companies for update using (public.is_admin() or id = public.my_company()) with check (public.is_admin() or id = public.my_company());
create policy admin_delete on public.companies for delete using (public.is_admin());

create policy read_self_or_admin on public.profiles for select using (public.is_admin() or id = auth.uid());
create policy admin_update on public.profiles for update using (public.is_admin()) with check (public.is_admin());

create policy admin_all on public.assignments for all using (public.is_admin()) with check (public.is_admin());
create policy supplier_read on public.assignments for select using (company_id = public.my_company() and status <> 'draft');
create policy supplier_update on public.assignments for update
  using (company_id = public.my_company() and status in ('requested','developing','submitted'))
  with check (company_id = public.my_company());

-- Private file storage, one folder per company: <company_id>/<assignment_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit) values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;
create policy attach_read on storage.objects for select
  using (bucket_id = 'attachments' and (public.is_admin() or (storage.foldername(name))[1] = public.my_company()::text));
create policy attach_insert on storage.objects for insert
  with check (bucket_id = 'attachments' and (public.is_admin() or (storage.foldername(name))[1] = public.my_company()::text));
create policy attach_delete on storage.objects for delete
  using (bucket_id = 'attachments' and (public.is_admin() or (storage.foldername(name))[1] = public.my_company()::text));

-- Live notifications in the app
alter publication supabase_realtime add table public.assignments;
