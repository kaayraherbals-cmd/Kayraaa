-- Email log. Run once in the Supabase SQL editor (or as a migration) after launch_subscribers.sql. Safe to run again.
-- Records WHAT was sent, to whom, and whether it worked. It never stores the message body.
-- Server-only: RLS on, no public policies.
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('contact_owner', 'contact_autoreply', 'launch_welcome', 'issue_owner')),
  to_email text not null check (char_length(to_email) <= 254),
  status text not null check (status in ('sent', 'failed')),
  provider_id text check (provider_id is null or char_length(provider_id) <= 80),
  error text check (error is null or char_length(error) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_created_idx on public.email_outbox (created_at desc);
create index if not exists email_outbox_failed_idx on public.email_outbox (created_at desc) where status = 'failed';
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
