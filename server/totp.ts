import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s) for admin two-step verification, plus the
 * helpers around them: secret encoding, encryption at rest, replay protection and recovery codes.
 * Compatible with Google Authenticator, Microsoft Authenticator, 1Password, Authy and similar apps.
 */
export const STEP_SECONDS = 30;
export const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  if (!clean) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 encoded (the form authenticator apps expect). */
export const generateSecret = (): string => base32Encode(randomBytes(20));

export const stepAt = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/** The code for one 30-second step. */
export function codeForStep(secretB32: string, step: number): string {
  const key = base32Decode(secretB32);
  if (!key) throw new Error('Invalid secret');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', key).update(counter).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Checks a typed code against the current step and one step either side (clock drift). A step at or before
 * `lastUsedStep` is refused, so a code that was already accepted cannot be replayed. Returns the matched step.
 */
export function verifyTotp(secretB32: string, input: string, nowMs: number, lastUsedStep = 0): { ok: true; step: number } | { ok: false } {
  const code = input.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const now = stepAt(nowMs);
  let hit = -1;
  // Check every candidate (no early exit) so timing does not reveal which step matched.
  for (const step of [now - 1, now, now + 1]) {
    if (safeEqual(codeForStep(secretB32, step), code) && step > lastUsedStep && step > hit) hit = step;
  }
  return hit >= 0 ? { ok: true, step: hit } : { ok: false };
}

export function otpauthUri(email: string, secretB32: string, issuer = 'Kaayra Herbals'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** "ABCD EFGH ..." for typing into an authenticator by hand. */
export const groupSecret = (secretB32: string): string => secretB32.match(/.{1,4}/g)?.join(' ') ?? secretB32;

// ---- Secrets at rest: AES-256-GCM with a key derived from ADMIN_MFA_KEY -----------------------------

export const MIN_MFA_KEY_LENGTH = 32;
const keyFrom = (secret: string): Buffer => createHash('sha256').update(`kaayra-mfa-v1:${secret}`).digest();

export function encryptSecret(plain: string, mfaKey: string): string {
  if (mfaKey.length < MIN_MFA_KEY_LENGTH) throw new Error('MFA key too short');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(mfaKey), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

/** Returns null if the key is wrong or the stored value was altered. */
export function decryptSecret(stored: string, mfaKey: string): string | null {
  if (mfaKey.length < MIN_MFA_KEY_LENGTH) return null;
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(mfaKey), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---- Recovery codes -----------------------------------------------------------------------------------

// 32 characters with no 0/O/1/I so a code copied by hand is hard to get wrong.
const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;

/** Ten single-use codes, shown to the person once, like "K7QM-2XPA-9TFD" (60 bits each). */
export function makeRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = Array.from(randomBytes(12), (b) => RC_ALPHABET[b % RC_ALPHABET.length]).join('');
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export const normaliseRecovery = (input: string): string => input.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const looksLikeRecovery = (input: string): boolean => normaliseRecovery(input).length === 12;

/** Only a keyed hash is stored, so a copy of the table cannot be used to sign in. */
export const hashRecovery = (code: string, mfaKey: string): string => createHmac('sha256', keyFrom(mfaKey)).update(normaliseRecovery(code)).digest('base64url');

/** Returns the remaining hashes with the used one removed, or null if the code is not on the list. */
export function consumeRecoveryCode(code: string, hashes: string[], mfaKey: string): string[] | null {
  if (!looksLikeRecovery(code)) return null;
  const h = hashRecovery(code, mfaKey);
  let found = -1;
  hashes.forEach((x, i) => {
    if (safeEqual(x, h)) found = i;
  });
  return found < 0 ? null : hashes.filter((_, i) => i !== found);
}
