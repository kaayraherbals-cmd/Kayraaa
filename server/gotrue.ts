import type { SupabaseConfig } from './supabase.js';

/** Thin wrappers over Supabase Auth (GoTrue). Passwords live there as bcrypt hashes; we never store them. */

export interface GoTrueUser {
  id?: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: { full_name?: unknown; name?: unknown; email_verified?: unknown };
}

export interface GoTrueResult {
  ok: boolean;
  status: number;
  code?: string;
  user?: GoTrueUser;
  hasSession?: boolean;
}

async function call(url: string, anonKey: string, body: unknown): Promise<GoTrueResult> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const user = (j.user ?? (j.id ? j : undefined)) as GoTrueUser | undefined;
  return {
    ok: r.ok,
    status: r.status,
    code: typeof j.error_code === 'string' ? j.error_code : typeof j.error === 'string' ? j.error : undefined,
    user,
    hasSession: typeof j.access_token === 'string',
  };
}

export const signUp = (db: SupabaseConfig, anonKey: string, p: { email: string; password: string; name: string; challenge: string; redirectTo: string }) =>
  call(`${db.url}/auth/v1/signup?redirect_to=${encodeURIComponent(p.redirectTo)}`, anonKey, {
    email: p.email,
    password: p.password,
    data: { full_name: p.name },
    code_challenge: p.challenge,
    code_challenge_method: 's256',
  });

export const passwordLogin = (db: SupabaseConfig, anonKey: string, email: string, password: string) =>
  call(`${db.url}/auth/v1/token?grant_type=password`, anonKey, { email, password });

export const recover = (db: SupabaseConfig, anonKey: string, p: { email: string; challenge: string; redirectTo: string }) =>
  call(`${db.url}/auth/v1/recover?redirect_to=${encodeURIComponent(p.redirectTo)}`, anonKey, {
    email: p.email,
    code_challenge: p.challenge,
    code_challenge_method: 's256',
  });

export async function exchangeCode(db: SupabaseConfig, anonKey: string, code: string, verifier: string): Promise<GoTrueUser | null> {
  const r = await call(`${db.url}/auth/v1/token?grant_type=pkce`, anonKey, { auth_code: code, code_verifier: verifier });
  return r.ok ? (r.user ?? null) : null;
}

/** Sets (or replaces) a user's password and name with the service role key. */
export async function setPasswordAndName(db: SupabaseConfig, userId: string, password: string, name: string): Promise<GoTrueResult> {
  const r = await fetch(`${db.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { apikey: db.serviceKey, Authorization: `Bearer ${db.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, user_metadata: { full_name: name } }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, code: typeof j.error_code === 'string' ? j.error_code : undefined };
}
