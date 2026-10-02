-- Two-step sign-in by email: after the password, a 6-digit code emailed to the person must be entered (once per sign-in
-- session). A session that came from an emailed link (invitation, sign-in link, password reset) already proved the mailbox.
-- Kept server-side only: no policies, so only the mfa edge function (service role) reads or writes these tables.
create table if not exists public.mfa_sessions (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null,
  verified_at timestamptz not null default now()
);
create table if not exists public.mfa_codes (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.mfa_sessions enable row level security;
alter table public.mfa_codes enable row level security;

-- True when the caller's current sign-in session has passed the email step.
create or replace function public.mfa_ok() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from mfa_sessions m where m.session_id = coalesce(auth.jwt()->>'session_id', '') and m.user_id = auth.uid());
$$;

-- Every access rule is built on these three helpers, so requiring the email step here locks all company data, files and
-- the admin screens until the code has been entered. (A person can still read their own profile row, nothing else.)
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin') and public.mfa_ok();
$$;
create or replace function public.my_company() returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() and public.mfa_ok();
$$;
create or replace function public.accepted_current_terms() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.mfa_ok() and not exists (
    select 1 from terms t where t.current and not exists (
      select 1 from agreement_log l where l.user_id = auth.uid() and l.doc = t.doc and l.version = t.version));
$$;
