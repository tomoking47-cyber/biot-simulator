-- Suppliers complete their own company profile (and change the temporary password) on first sign-in.
alter table public.companies add column if not exists profile_completed_at timestamptz;
