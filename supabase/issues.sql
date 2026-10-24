-- Run once in the Supabase SQL editor (or as a migration). Server-only: RLS is on and no public policies exist,
-- so only the service role (the /api functions) can read or write.

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique check (ref ~ '^IS-[A-HJ-NP-Z2-9]{6}$'),
  category text not null check (category in ('broken', 'sign-in', 'display', 'content', 'other')),
  summary text not null check (char_length(summary) between 5 and 120),
  details text not null check (char_length(details) between 10 and 2000),
  error_code text check (error_code is null or error_code ~ '^KH-[A-Z]{2,5}-[0-9]{3}$'),
  error_ref text check (error_ref is null or error_ref ~ '^R-[A-HJ-NP-Z2-9]{8}$'),
  page text check (page is null or char_length(page) <= 200),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  user_agent text check (user_agent is null or char_length(user_agent) <= 200),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'closed')),
  severity text not null default 'normal' check (severity in ('low', 'normal', 'high')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists issues_status_created_idx on public.issues (status, created_at desc);
create index if not exists issues_error_code_idx on public.issues (error_code);

alter table public.issues enable row level security;
revoke all on public.issues from anon, authenticated;
