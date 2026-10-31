import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens for cart recovery (Phase 7).
 *
 * RESTORE token: 32 random bytes from the operating system's CSPRNG, base64url (43 characters, 256 bits). It carries no data at all:
 * no email, no cart, no order, no price. Only its SHA-256 hash is stored, so a database leak does not leak working links. It is
 * looked up server side, expires (settings.token_ttl_hours), is revoked the moment the bag is bought, emptied, changed or the
 * customer unsubscribes, and even a valid token only works for the signed-in owner of that bag.
 *
 * UNSUBSCRIBE token: signed (HMAC-SHA256), carries the member id and nothing else, and never expires, because a person must always
 * be able to leave. It uses its own signing prefix, so a launch-list token can never be used here and the reverse.
 */
export const RESTORE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newRestoreToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRestoreToken(token) };
}

export const hashRestoreToken = (token: string): string => createHash('sha256').update(`kaayra-restore.${token}`).digest('hex');

/** True only for a well-formed token. Anything else is rejected before the database is touched. */
export const isRestoreToken = (v: unknown): v is string => typeof v === 'string' && RESTORE_TOKEN_RE.test(v);

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(`kaayra-cart-unsub.${body}`).digest();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signUnsubscribeToken(memberId: string, secret: string): string {
  const body = b64(JSON.stringify({ p: 'cart-unsub', m: memberId.toLowerCase() }));
  return `${body}.${b64(mac(secret, body))}`;
}

/** Returns the member id when the token is genuine and for this purpose, otherwise null. */
export function verifyUnsubscribeToken(token: unknown, secret: string): string | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = mac(secret, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { p?: unknown; m?: unknown };
    return p.p === 'cart-unsub' && typeof p.m === 'string' && UUID.test(p.m) ? p.m.toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface RecoveryLinks {
  siteUrl: string;
  secret: string;
}

/** Same rule as the launch list: links in email need a long secret and a real https address, otherwise recovery mail is not sent. */
export function recoveryLinkConfig(env: Record<string, string | undefined> = process.env): RecoveryLinks | null {
  const secret = env.SUBSCRIBE_TOKEN_SECRET?.trim() ?? '';
  if (secret.length < 32) return null;
  const site = (env.SITE_URL?.trim() || env.VITE_SITE_URL?.trim() || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(site) || /\.example(\/|$)/i.test(site) || /localhost/i.test(site)) return null;
  return { siteUrl: site, secret };
}

export const restoreUrl = (l: RecoveryLinks, token: string): string => `${l.siteUrl}/bag?recover=${token}`;
export const unsubscribePageUrl = (l: RecoveryLinks, memberId: string): string => `${l.siteUrl}/subscription?a=cart-unsubscribe&t=${signUnsubscribeToken(memberId, l.secret)}`;
export const oneClickUnsubscribeUrl = (l: RecoveryLinks, memberId: string): string => `${l.siteUrl}/api/cart/unsubscribe?u=${signUnsubscribeToken(memberId, l.secret)}`;
