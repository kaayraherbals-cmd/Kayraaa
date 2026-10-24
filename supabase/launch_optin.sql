-- Launch list: double opt-in, unsubscribe and a consent history. Run after launch_subscribers.sql and email_outbox.sql. Safe to run again.
-- Server-only tables (RLS on, no public policies).

alter table public.launch_subscribers add column if not exists status text not null default 'pending';
alter table public.launch_subscribers add column if not exists optin_method text not null default 'single_legacy';
alter table public.launch_subscribers add column if not exists confirmation_sent_at timestamptz;
alter table public.launch_subscribers add column if not exists confirmed_at timestamptz;
alter table public.launch_subscribers add column if not exists unsubscribed_at timestamptz;
-- Rows that existed before this migration joined with a single step and were never asked to confirm: they keep
-- optin_method = 'single_legacy' and status = 'pending', so nobody is mailed on an unconfirmed basis. New rows are 'double'.
alter table public.launch_subscribers alter column optin_method set default 'double';

alter table public.launch_subscribers drop constraint if exists launch_subscribers_status_check;
alter table public.launch_subscribers add constraint launch_subscribers_status_check check (status in ('pending', 'confirmed', 'unsubscribed'));
alter table public.launch_subscribers drop constraint if exists launch_subscribers_optin_method_check;
alter table public.launch_subscribers add constraint launch_subscribers_optin_method_check check (optin_method in ('double', 'single_legacy'));
create index if not exists launch_subscribers_status_idx on public.launch_subscribers (status);

-- Proof of consent and withdrawal that survives deleting a subscriber: only a SHA-256 of the address is kept, never the address.
create table if not exists public.launch_consent_log (
  id bigint generated always as identity primary key,
  email_hash text not null check (char_length(email_hash) = 64),
  event text not null check (event in ('requested', 'confirmed', 'unsubscribed')),
  consent_text_version text not null,
  at timestamptz not null default now()
);
create index if not exists launch_consent_log_hash_idx on public.launch_consent_log (email_hash, at desc);
alter table public.launch_consent_log enable row level security;
revoke all on public.launch_consent_log from anon, authenticated;

-- The email log gains the confirmation mail.
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('contact_owner', 'contact_autoreply', 'launch_confirm', 'launch_welcome', 'issue_owner'));
