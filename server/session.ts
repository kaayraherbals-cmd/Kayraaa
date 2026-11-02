import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'kaayra_admin';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MIN_SECRET_LENGTH = 32;

export interface Session {
  email: string;
  exp: number; // epoch seconds
  /** Epoch seconds of the two-step enrolment this session has verified against; 0 when not verified. */
  mfa: number;
  /** Fingerprint of the passkey this session was signed in with (empty for a password session). */
  pk?: string;
}

const b64u = (input: string | Buffer) => Buffer.from(input).toString('base64url');

function mac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export function signSession(email: string, secret: string, nowMs = Date.now(), ttl = SESSION_TTL_SECONDS, mfa = 0, pk = ''): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('Session secret too short');
  const body: Session = { email: email.toLowerCase(), exp: Math.floor(nowMs / 1000) + ttl, mfa, ...(pk ? { pk } : {}) };
  const payload = b64u(JSON.stringify(body));
  return `${payload}.${b64u(mac(payload, secret))}`;
}

export function verifySession(token: string | undefined, secret: string, nowMs = Date.now()): Session | null {
  if (!token || secret.length < MIN_SECRET_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = mac(payload, secret);
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Session>;
    if (typeof s.email !== 'string' || typeof s.exp !== 'number') return null;
    if (s.exp <= Math.floor(nowMs / 1000)) return null;
    return { email: s.email, exp: s.exp, mfa: typeof s.mfa === 'number' ? s.mfa : 0, ...(typeof s.pk === 'string' && s.pk.length > 0 && s.pk.length <= 32 ? { pk: s.pk } : {}) };
  } catch {
    return null;
  }
}

export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string, allowed: string[]): boolean {
  return allowed.includes(email.trim().toLowerCase());
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearCookie(secure: boolean): string {
  return [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}
