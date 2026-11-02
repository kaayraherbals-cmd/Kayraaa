-- Run once in the Supabase SQL editor (after roles_mfa_audit.sql). Safe to run again.
-- Adds: passkeys (WebAuthn) for admin sign-in. Only the PUBLIC key is stored, so a database leak cannot be used to sign in.
-- Server-only: RLS on, no grants to anon or authenticated.

create table if not exists public.admin_passkeys (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  -- WebAuthn credential id (base64url). Unique across all admins.
  credential_id text not null unique,
  -- Short fingerprint of credential_id; a sign-in session carries it so deleting the passkey ends that session.
  id_hash text not null,
  -- Public key, SPKI DER, base64url.
  public_key text not null,
  -- COSE algorithm: -7 (ES256) or -257 (RS256).
  alg integer not null check (alg in (-7, -257)),
  sign_count bigint not null default 0,
  transports text[] not null default '{}',
  name text not null check (char_length(name) between 1 and 60),
  backed_up boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists admin_passkeys_email_idx on public.admin_passkeys (email);
create index if not exists admin_passkeys_hash_idx on public.admin_passkeys (email, id_hash);
alter table public.admin_passkeys enable row level security;
revoke all on public.admin_passkeys from anon, authenticated;
