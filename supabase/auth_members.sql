-- Run in the Supabase SQL editor after launch_subscribers.sql. Safe to run again (upgrades an existing install).
-- Server-only tables: RLS on, no public policies, so only the service role (our API) can touch them.

-- Everyone who has signed in. id is the Supabase auth user id. Passwords are NOT stored here: Supabase Auth keeps them as hashes.
create table if not exists public.members (
  id uuid primary key,
  email text not null,
  name text check (name is null or char_length(name) <= 200),
  role text not null default 'member' check (role in ('admin', 'member')),
  provider text not null,
  has_password boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  constraint members_email_lower check (email = lower(email)),
  constraint members_email_key unique (email)
);

-- Upgrade path for installs created before password sign-in existed.
alter table public.members add column if not exists has_password boolean not null default false;

-- Kept for compatibility with earlier versions; no longer used (sign-up no longer waits for an admin).
create table if not exists public.site_state (
  id boolean primary key default true check (id),
  admin_first_login_at timestamptz
);
insert into public.site_state (id) values (true) on conflict (id) do nothing;

alter table public.members enable row level security;
alter table public.site_state enable row level security;
revoke all on public.members from anon, authenticated;
revoke all on public.site_state from anon, authenticated;
