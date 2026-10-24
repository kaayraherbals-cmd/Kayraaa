-- Run once in the Supabase SQL editor (after launch_subscribers.sql). Safe to run again.
-- Adds: two-step verification storage for admins, an append-only audit log, and indexes for the audit log viewer.
-- Server-only: RLS on, no public policies.

create table if not exists public.admin_mfa (
  email text primary key check (email = lower(email)),
  -- The authenticator secret, AES-256-GCM encrypted by the server with ADMIN_MFA_KEY. Never stored in plain text.
  secret_enc text not null,
  -- Null while setup is unfinished (secret generated, first code not yet confirmed).
  enabled_at timestamptz,
  -- Highest 30-second step already accepted, so a code cannot be used twice.
  last_step bigint not null default 0,
  -- Keyed hashes of the unused single-use recovery codes.
  recovery_hashes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admin_mfa enable row level security;
revoke all on public.admin_mfa from anon, authenticated;

create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
create index if not exists admin_audit_actor_idx on public.admin_audit (actor);
create index if not exists admin_audit_action_idx on public.admin_audit (action);

-- The audit log is append-only: rows cannot be changed or removed through the API or the SQL editor.
-- (To honour a lawful erasure request, an owner can drop this trigger, make the change, and recreate it. That is deliberate friction.)
create or replace function public.admin_audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit is append-only';
end $$;
drop trigger if exists admin_audit_no_change on public.admin_audit;
create trigger admin_audit_no_change before update or delete on public.admin_audit for each row execute function public.admin_audit_immutable();
drop trigger if exists admin_audit_no_truncate on public.admin_audit;
create trigger admin_audit_no_truncate before truncate on public.admin_audit for each statement execute function public.admin_audit_immutable();
