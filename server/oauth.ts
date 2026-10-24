import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isAdminEmail } from './session.js';

/** OAuth providers this site may offer. Which ones are live is set by OAUTH_PROVIDERS (default: google). */
export const KNOWN_PROVIDERS = ['google', 'github', 'azure'] as const;
export type Provider = (typeof KNOWN_PROVIDERS)[number];

export const USER_COOKIE = 'kaayra_user';
export const OAUTH_COOKIE = 'kaayra_oauth';
export const SETUP_COOKIE = 'kaayra_setup';
export const SETUP_TTL_SECONDS = 20 * 60;
export const OAUTH_TTL_SECONDS = 10 * 60;
export const MEMBER_TTL_SECONDS = 7 * 24 * 60 * 60;
export const ADMIN_TTL_SECONDS = 8 * 60 * 60;

export type Role = 'admin' | 'member';
export type Intent = 'admin' | 'member';

/** Google is always offered (sign-in and sign-up); OAUTH_PROVIDERS can only add GitHub or Microsoft on top. */
export function parseProviders(raw: string | undefined): Provider[] {
  const wanted = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return KNOWN_PROVIDERS.filter((p) => p === 'google' || wanted.includes(p));
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (KNOWN_PROVIDERS as readonly string[]).includes(value);
}

// ---- PKCE ------------------------------------------------------------------------------------------

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(supabaseUrl: string, provider: Provider, redirectTo: string, challenge: string): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize`);
  u.searchParams.set('provider', provider);
  u.searchParams.set('redirect_to', redirectTo);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 's256');
  return u.toString();
}

// ---- Signed, purpose-bound tokens (a token for one purpose can never be replayed as another) -------

function mac(purpose: string, payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${purpose}.${payload}`).digest();
}

export function signToken(purpose: string, data: Record<string, unknown>, secret: string, ttlSeconds: number, nowMs = Date.now()): string {
  if (secret.length < 32) throw new Error('Secret too short');
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(nowMs / 1000) + ttlSeconds })).toString('base64url');
  return `${payload}.${mac(purpose, payload, secret).toString('base64url')}`;
}

export function verifyToken<T extends Record<string, unknown>>(
  purpose: string,
  token: string | undefined,
  secret: string,
  nowMs = Date.now(),
): (T & { exp: number }) | null {
  if (!token || secret.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = mac(purpose, payload, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T & { exp?: unknown };
    if (typeof body.exp !== 'number' || body.exp <= Math.floor(nowMs / 1000)) return null;
    return body as T & { exp: number };
  } catch {
    return null;
  }
}

// ---- Cookies ---------------------------------------------------------------------------------------

/** The OAuth round-trip cookie is Lax (the callback is a cross-site navigation) and scoped to /api/auth. */
export function oauthCookie(token: string, secure: boolean, ttl = OAUTH_TTL_SECONDS): string {
  return [`${OAUTH_COOKIE}=${token}`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Lax', `Max-Age=${ttl}`, ...(secure ? ['Secure'] : [])].join('; ');
}
/** Short-lived cookie held between "signed in with Google / clicked reset link" and "chose a password". */
export function setupCookie(token: string, secure: boolean): string {
  return [`${SETUP_COOKIE}=${token}`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SETUP_TTL_SECONDS}`, ...(secure ? ['Secure'] : [])].join('; ');
}
export function clearSetupCookie(secure: boolean): string {
  return [`${SETUP_COOKIE}=`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}
export function clearOauthCookie(secure: boolean): string {
  return [`${OAUTH_COOKIE}=`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}
export function userCookie(token: string, ttl: number, secure: boolean): string {
  return [`${USER_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${ttl}`, ...(secure ? ['Secure'] : [])].join('; ');
}
export function clearUserCookie(secure: boolean): string {
  return [`${USER_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}

// ---- Redirect safety -------------------------------------------------------------------------------

const NEXT_ALLOWED = new Set(['/admin', '/account', '/set-password', '/']);

/** Only ever redirect to a known in-site path after sign-in. */
export function safeNext(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && NEXT_ALLOWED.has(raw) ? raw : fallback;
}

// ---- The access rule -------------------------------------------------------------------------------

export type DenyReason = 'unverified_email' | 'not_admin' | 'signup_closed';

export interface AccessInput {
  email: string | undefined;
  emailConfirmed: boolean;
  intent: Intent;
  adminEmails: string[];
  /** True if this person already has a members row. */
  existingMember: boolean;
  /** MEMBER_SIGNUP=open (the default) lets new members register. */
  signupOpen: boolean;
}

export type AccessDecision = { ok: true; role: Role } | { ok: false; reason: DenyReason };

/**
 * Who may get in:
 *  1. The email must be verified (by Google, or by clicking the link we email for password sign-ups).
 *  2. Addresses on ADMIN_EMAILS are admins and are always allowed.
 *  3. The admin entry point never creates accounts: anyone else is refused there.
 *  4. Existing members can always sign in; new members only if sign-up is open.
 * Admin rights come only from the allowlist, never from "whoever got here first".
 */
export function decideAccess(i: AccessInput): AccessDecision {
  if (!i.email || !i.emailConfirmed) return { ok: false, reason: 'unverified_email' };
  if (isAdminEmail(i.email, i.adminEmails)) return { ok: true, role: 'admin' };
  if (i.intent === 'admin') return { ok: false, reason: 'not_admin' };
  if (!i.existingMember && !i.signupOpen) return { ok: false, reason: 'signup_closed' };
  return { ok: true, role: 'member' };
}
