import { rest, type SupabaseConfig } from './supabase.js';

export interface PasskeyRow {
  id: string;
  email: string;
  credential_id: string;
  id_hash: string;
  public_key: string;
  alg: number;
  sign_count: number;
  transports: string[];
  name: string;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}
const COLS = 'id,email,credential_id,id_hash,public_key,alg,sign_count,transports,name,backed_up,created_at,last_used_at';
export const MAX_PASSKEYS_PER_ADMIN = 10;

export async function listPasskeys(db: SupabaseConfig, email: string): Promise<PasskeyRow[]> {
  const r = await rest(db, `admin_passkeys?select=${COLS}&email=eq.${encodeURIComponent(email.toLowerCase())}&order=created_at.asc`);
  if (!r.ok) throw new Error(`passkeys read ${r.status}`);
  return (await r.json()) as PasskeyRow[];
}
export async function findByCredential(db: SupabaseConfig, credentialId: string): Promise<PasskeyRow | null> {
  const r = await rest(db, `admin_passkeys?select=${COLS}&credential_id=eq.${encodeURIComponent(credentialId)}&limit=1`);
  if (!r.ok) throw new Error(`passkey lookup ${r.status}`);
  return ((await r.json()) as PasskeyRow[])[0] ?? null;
}
/** True while a passkey with this fingerprint still exists for the admin: the check that ties a passkey session to its passkey. */
export async function hasActivePasskey(db: SupabaseConfig, email: string, idHash: string): Promise<boolean> {
  const r = await rest(db, `admin_passkeys?select=id&email=eq.${encodeURIComponent(email.toLowerCase())}&id_hash=eq.${encodeURIComponent(idHash)}&limit=1`);
  if (!r.ok) throw new Error(`passkey check ${r.status}`);
  return ((await r.json()) as unknown[]).length > 0;
}
export async function insertPasskey(db: SupabaseConfig, row: Omit<PasskeyRow, 'id' | 'created_at' | 'last_used_at'>): Promise<'ok' | 'duplicate'> {
  const r = await rest(db, 'admin_passkeys', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  if (r.status === 409) return 'duplicate';
  if (!r.ok) throw new Error(`passkey insert ${r.status}`);
  return 'ok';
}
/** Records a successful use. Compare-and-set on the old counter, so the same signed response cannot be accepted twice. */
export async function touchPasskey(db: SupabaseConfig, row: PasskeyRow, signCount: number, backedUp: boolean, nowMs = Date.now()): Promise<boolean> {
  const r = await rest(db, `admin_passkeys?id=eq.${row.id}&sign_count=eq.${row.sign_count}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ sign_count: signCount, backed_up: backedUp, last_used_at: new Date(nowMs).toISOString() }),
  });
  if (!r.ok) throw new Error(`passkey touch ${r.status}`);
  return ((await r.json()) as unknown[]).length > 0;
}
export async function renamePasskey(db: SupabaseConfig, email: string, id: string, name: string): Promise<boolean> {
  const r = await rest(db, `admin_passkeys?id=eq.${id}&email=eq.${encodeURIComponent(email.toLowerCase())}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name }) });
  if (!r.ok) throw new Error(`passkey rename ${r.status}`);
  return ((await r.json()) as unknown[]).length > 0;
}
export async function deletePasskey(db: SupabaseConfig, email: string, id: string): Promise<PasskeyRow | null> {
  const r = await rest(db, `admin_passkeys?id=eq.${id}&email=eq.${encodeURIComponent(email.toLowerCase())}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!r.ok) throw new Error(`passkey delete ${r.status}`);
  return ((await r.json()) as PasskeyRow[])[0] ?? null;
}
/** How many passkeys each admin has (for the owner's Team table). Never returns key material. */
export async function passkeyCounts(db: SupabaseConfig): Promise<Map<string, number>> {
  const r = await rest(db, 'admin_passkeys?select=email&limit=1000');
  if (!r.ok) throw new Error(`passkey counts ${r.status}`);
  const out = new Map<string, number>();
  for (const { email } of (await r.json()) as { email: string }[]) out.set(email, (out.get(email) ?? 0) + 1);
  return out;
}
/** Removes one passkey by id, whoever it belongs to. Only for an owner acting on someone else; the caller must check the role. */
export async function deletePasskeyAsOwner(db: SupabaseConfig, id: string): Promise<PasskeyRow | null> {
  const r = await rest(db, `admin_passkeys?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!r.ok) throw new Error(`passkey owner delete ${r.status}`);
  return ((await r.json()) as PasskeyRow[])[0] ?? null;
}
/** What the browser may see: never the key material. */
export const publicPasskey = (p: PasskeyRow, currentHash?: string) => ({ id: p.id, name: p.name, created_at: p.created_at, last_used_at: p.last_used_at, backed_up: p.backed_up, transports: p.transports, current: Boolean(currentHash) && p.id_hash === currentHash });
