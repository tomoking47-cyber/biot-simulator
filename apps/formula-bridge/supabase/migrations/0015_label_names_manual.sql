-- Japan-side staff can confirm a label name by eye ("manual"); it is then reused like a verified one.
alter table public.label_names drop constraint if exists label_names_level_check;
alter table public.label_names add constraint label_names_level_check check (level in ('official', 'web', 'manual'));
alter table public.label_names add column if not exists confirmed_by text;
create policy label_names_admin_insert on public.label_names for insert with check (public.is_admin() and level = 'manual');
create policy label_names_admin_update on public.label_names for update using (public.is_admin()) with check (public.is_admin() and level = 'manual');
