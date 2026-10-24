-- Run once in the Supabase SQL editor (or as a migration).
-- All tables are server-only: RLS is on and no public policies exist, so only the service role can read or write.

create table if not exists public.launch_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  consent_given boolean not null default true,
  consent_text_version text not null,
  consented_at timestamptz not null default now(),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  constraint launch_subscribers_email_key unique (email),
  constraint launch_subscribers_email_lower check (email = lower(email))
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) <= 254),
  message text not null check (char_length(message) between 10 and 2000),
  status text not null default 'new' check (status in ('new', 'handled')),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

alter table public.launch_subscribers enable row level security;
alter table public.contact_messages enable row level security;
alter table public.admin_audit enable row level security;

revoke all on public.launch_subscribers from anon, authenticated;
revoke all on public.contact_messages from anon, authenticated;
revoke all on public.admin_audit from anon, authenticated;
