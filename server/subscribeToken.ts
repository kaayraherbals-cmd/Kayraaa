import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Signed links for the launch list (double opt-in and unsubscribe).
 *
 * A token is `base64url(JSON {p: purpose, e: email, t: issuedAtMs}) + '.' + base64url(HMAC-SHA256)`. Nothing is stored for it:
 * the server recomputes the signature. A token can only do the one thing named in its purpose, so a confirm link can never
 * unsubscribe and an unsubscribe link can never confirm. Confirm links expire; unsubscribe links never do (people must
 * always be able to leave).
 */
export type TokenPurpose = 'confirm' | 'unsubscribe';
export const MIN_SUBSCRIBE_SECRET_LENGTH = 32;
export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function mac(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(`kaayra-launch.${body}`).digest();
}

export function signToken(purpose: TokenPurpose, email: string, secret: string, nowMs = Date.now()): string {
  const body = b64(JSON.stringify({ p: purpose, e: email.toLowerCase(), t: nowMs }));
  return `${body}.${b64(mac(secret, body))}`;
}

/** Returns the email when the token is genuine, for this purpose, and (for confirm) not expired. Otherwise null. */
export function verifyToken(token: unknown, purpose: TokenPurpose, secret: string, nowMs = Date.now()): string | null {
  if (typeof token !== 'string' || token.length > 600) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = mac(secret, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { p?: unknown; e?: unknown; t?: unknown };
    if (p.p !== purpose || typeof p.e !== 'string' || typeof p.t !== 'number') return null;
    if (purpose === 'confirm' && (nowMs - p.t > CONFIRM_TTL_MS || p.t > nowMs + 60_000)) return null;
    return p.e;
  } catch {
    return null;
  }
}

export const emailHash = (email: string): string => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

export interface SubscribeConfig {
  secret: string;
  /** Public site address used in email links. No trailing slash. */
  siteUrl: string;
}

/**
 * Links in emails must point at the real site. Without a long secret and a real https address (not the build placeholder)
 * the launch list stays closed: nothing is stored, nothing is sent.
 */
export function subscribeConfig(env: Record<string, string | undefined> = process.env): SubscribeConfig | null {
  const secret = env.SUBSCRIBE_TOKEN_SECRET?.trim() ?? '';
  if (secret.length < MIN_SUBSCRIBE_SECRET_LENGTH) return null;
  const site = (env.SITE_URL?.trim() || env.VITE_SITE_URL?.trim() || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(site) || /\.example(\/|$)/i.test(site)) return null;
  return { secret, siteUrl: site };
}

export const confirmUrl = (c: SubscribeConfig, email: string, nowMs = Date.now()) =>
  `${c.siteUrl}/subscription?a=confirm&t=${signToken('confirm', email, c.secret, nowMs)}`;
export const unsubscribeToken = (c: SubscribeConfig, email: string) => signToken('unsubscribe', email, c.secret, 0);
export const unsubscribeUrl = (c: SubscribeConfig, email: string) => `${c.siteUrl}/subscription?a=unsubscribe&t=${unsubscribeToken(c, email)}`;
/** RFC 8058 one-click endpoint: a mail client POSTs here without opening the site. */
export const oneClickUrl = (c: SubscribeConfig, email: string) => `${c.siteUrl}/api/subscribe?u=${unsubscribeToken(c, email)}`;
