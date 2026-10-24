import { MIN_MFA_KEY_LENGTH, decryptSecret, encryptSecret, generateSecret, hashRecovery, makeRecoveryCodes, consumeRecoveryCode, verifyTotp } from './totp.js';
import { rest, type SupabaseConfig } from './supabase.js';

export type MfaMode = 'required' | 'optional';
/** What a signed-in admin must still do: nothing (ok), enter a code (verify) or set up two-step (enroll). */
export type MfaState = 'ok' | 'verify' | 'enroll';

export interface MfaRow {
  email: string;
  secret_enc: string;
  enabled_at: string | null;
  last_step: number;
  recovery_hashes: string[];
}

export const parseMfaMode = (raw: string | undefined): MfaMode => ((raw ?? '').trim().toLowerCase() === 'optional' ? 'optional' : 'required');
export const enrolledEpoch = (row: MfaRow | null): number => (row?.enabled_at ? Math.floor(Date.parse(row.enabled_at) / 1000) : 0);

/** Pure decision, used on every admin request. A session proves two-step only for the enrolment it was verified against. */
export function mfaState(mode: MfaMode, row: MfaRow | null, sessionMfa: number): MfaState {
  const epoch = enrolledEpoch(row);
  if (!epoch) return mode === 'required' ? 'enroll' : 'ok';
  return sessionMfa === epoch ? 'ok' : 'verify';
}

const COLS = 'email,secret_enc,enabled_at,last_step,recovery_hashes';

export async function getMfa(db: SupabaseConfig, email: string): Promise<MfaRow | null> {
  const r = await rest(db, `admin_mfa?select=${COLS}&email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`);
  if (!r.ok) throw new Error(`mfa read ${r.status}`);
  return ((await r.json()) as MfaRow[])[0] ?? null;
}

export async function listEnrolled(db: SupabaseConfig): Promise<Set<string>> {
  const r = await rest(db, 'admin_mfa?select=email&enabled_at=not.is.null');
  if (!r.ok) throw new Error(`mfa list ${r.status}`);
  return new Set(((await r.json()) as { email: string }[]).map((x) => x.email));
}

/** Starts (or restarts) setup. Refused if two-step is already on: it must be reset by an owner. */
export async function beginEnrol(db: SupabaseConfig, email: string, mfaKey: string): Promise<{ secret: string } | 'already'> {
  if (mfaKey.length < MIN_MFA_KEY_LENGTH) throw new Error('MFA key too short');
  const existing = await getMfa(db, email);
  if (existing?.enabled_at) return 'already';
  const secret = generateSecret();
  const r = await rest(db, 'admin_mfa?on_conflict=email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ email: email.toLowerCase(), secret_enc: encryptSecret(secret, mfaKey), enabled_at: null, last_step: 0, recovery_hashes: [], updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`mfa begin ${r.status}`);
  return { secret };
}

/** Confirms setup with the first code. Returns the recovery codes (shown once) and the enrolment epoch for the session. */
export async function confirmEnrol(db: SupabaseConfig, email: string, code: string, mfaKey: string, nowMs = Date.now()): Promise<{ recoveryCodes: string[]; epoch: number } | 'bad_code' | 'no_setup' | 'already'> {
  const row = await getMfa(db, email);
  if (!row) return 'no_setup';
  if (row.enabled_at) return 'already';
  const secret = decryptSecret(row.secret_enc, mfaKey);
  if (!secret) return 'no_setup';
  const v = verifyTotp(secret, code, nowMs, 0);
  if (!v.ok) return 'bad_code';
  const codes = makeRecoveryCodes();
  const enabledAt = new Date(nowMs).toISOString();
  const r = await rest(db, `admin_mfa?email=eq.${encodeURIComponent(email.toLowerCase())}&enabled_at=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ enabled_at: enabledAt, last_step: v.step, recovery_hashes: codes.map((c) => hashRecovery(c, mfaKey)), updated_at: enabledAt }),
  });
  if (!r.ok) throw new Error(`mfa confirm ${r.status}`);
  if (((await r.json()) as unknown[]).length === 0) return 'already';
  return { recoveryCodes: codes, epoch: Math.floor(nowMs / 1000) };
}

/** Checks a sign-in code (or a recovery code). The step or code is consumed with a compare-and-set so it cannot be reused. */
export async function verifyLogin(db: SupabaseConfig, email: string, input: string, mfaKey: string, nowMs = Date.now()): Promise<{ epoch: number; method: 'totp' | 'recovery'; recoveryLeft?: number } | 'bad_code' | 'not_enrolled'> {
  const row = await getMfa(db, email);
  if (!row?.enabled_at) return 'not_enrolled';
  const epoch = enrolledEpoch(row);
  const secret = decryptSecret(row.secret_enc, mfaKey);
  const mail = encodeURIComponent(email.toLowerCase());
  if (secret) {
    const v = verifyTotp(secret, input, nowMs, Number(row.last_step));
    if (v.ok) {
      const r = await rest(db, `admin_mfa?email=eq.${mail}&last_step=eq.${row.last_step}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ last_step: v.step }) });
      if (!r.ok) throw new Error(`mfa step ${r.status}`);
      return ((await r.json()) as unknown[]).length ? { epoch, method: 'totp' } : 'bad_code';
    }
  }
  const remaining = consumeRecoveryCode(input, row.recovery_hashes, mfaKey);
  if (remaining) {
    const r = await rest(db, `admin_mfa?email=eq.${mail}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ recovery_hashes: remaining, updated_at: new Date(nowMs).toISOString() }) });
    if (!r.ok) throw new Error(`mfa recovery ${r.status}`);
    return { epoch, method: 'recovery', recoveryLeft: remaining.length };
  }
  return 'bad_code';
}

/** Owner action: removes someone's enrolment so they must set up again. */
export async function resetMfa(db: SupabaseConfig, email: string): Promise<void> {
  const r = await rest(db, `admin_mfa?email=eq.${encodeURIComponent(email.toLowerCase())}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`mfa reset ${r.status}`);
}
