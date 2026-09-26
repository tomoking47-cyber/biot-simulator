-- Verified Japanese cosmetic label names (成分表示名称), keyed by normalised INCI name.
-- Filled only by the ai function after it has itself opened the source page and found the INCI name and the
-- Japanese name next to each other ("official" = jcia.org, "web" = another page). Reused for later conversions.
create table if not exists public.label_names (
  inci_key text primary key,
  inci text not null,
  ja text not null,
  level text not null check (level in ('official', 'web')),
  source_url text not null,
  checked_at timestamptz not null default now()
);
alter table public.label_names enable row level security;
create policy label_names_admin_read on public.label_names for select using (public.is_admin());
create policy label_names_admin_delete on public.label_names for delete using (public.is_admin());
