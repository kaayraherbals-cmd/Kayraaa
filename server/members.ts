import { rest, type SupabaseConfig } from './supabase.js';
import type { Role } from './oauth.js';

export interface Member {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  has_password: boolean;
}

/** Email is the stable key: the same person signing in with two providers is one member. */
export async function findMemberByEmail(db: SupabaseConfig, email: string): Promise<Member | null> {
  const r = await rest(db, `members?select=id,email,name,role,has_password&email=eq.${encodeURIComponent(email.trim().toLowerCase())}&limit=1`);
  if (!r.ok) throw new Error(`find member ${r.status}`);
  const rows = (await r.json()) as Member[];
  return rows[0] ?? null;
}

export async function upsertMember(
  db: SupabaseConfig,
  m: { id: string; email: string; name: string | null; role: Role; provider: string; hasPassword?: boolean },
): Promise<void> {
  const { hasPassword, name, ...rest_ } = m;
  const row: Record<string, unknown> = { ...rest_, email: m.email.toLowerCase(), last_login_at: new Date().toISOString() };
  // Never wipe a stored name or password flag just because this sign-in did not carry one.
  if (name) row.name = name;
  if (hasPassword !== undefined) row.has_password = hasPassword;
  const r = await rest(db, 'members?on_conflict=email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`upsert member ${r.status}`);
}

export async function deleteMember(db: SupabaseConfig, authId: string): Promise<void> {
  const r = await rest(db, `members?id=eq.${encodeURIComponent(authId)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete member ${r.status}`);
  // Remove the Supabase auth identity too, so the person's data is actually erased.
  const a = await fetch(`${db.url}/auth/v1/admin/users/${encodeURIComponent(authId)}`, {
    method: 'DELETE',
    headers: { apikey: db.serviceKey, Authorization: `Bearer ${db.serviceKey}` },
  });
  if (!a.ok && a.status !== 404) throw new Error(`delete auth user ${a.status}`);
}

export async function auditEvent(db: SupabaseConfig, actor: string, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await rest(db, 'admin_audit', { method: 'POST', body: JSON.stringify({ actor, action, detail }) });
  } catch {
    /* best effort */
  }
}
