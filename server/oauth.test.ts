import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, decideAccess, makePkce, parseProviders, safeNext, signToken, verifyToken, type AccessInput } from './oauth.js';
import { createHash } from 'node:crypto';

const SECRET = 'x'.repeat(40);
const base: AccessInput = {
  email: 'person@example.com',
  emailConfirmed: true,
  intent: 'member',
  adminEmails: ['boss@kaayra.in'],
  existingMember: false,
  signupOpen: true,
};

describe('access rule', () => {
  it('lets an allowlisted admin in, with either intent', () => {
    expect(decideAccess({ ...base, email: 'BOSS@kaayra.in' })).toEqual({ ok: true, role: 'admin' });
    expect(decideAccess({ ...base, email: 'boss@kaayra.in', intent: 'admin' })).toEqual({ ok: true, role: 'admin' });
  });
  it('lets a new person in as a member without waiting for an admin', () => {
    expect(decideAccess(base)).toEqual({ ok: true, role: 'member' });
  });
  it('never makes a non-admin an admin, and the admin entry never creates accounts', () => {
    expect(decideAccess({ ...base, intent: 'admin' })).toEqual({ ok: false, reason: 'not_admin' });
  });
  it('requires a verified email, even for admins', () => {
    expect(decideAccess({ ...base, emailConfirmed: false })).toEqual({ ok: false, reason: 'unverified_email' });
    expect(decideAccess({ ...base, email: 'boss@kaayra.in', emailConfirmed: false })).toEqual({ ok: false, reason: 'unverified_email' });
    expect(decideAccess({ ...base, email: undefined })).toEqual({ ok: false, reason: 'unverified_email' });
  });
  it('admits new members only while sign-up is open, but always lets existing members back in', () => {
    expect(decideAccess({ ...base, signupOpen: false })).toEqual({ ok: false, reason: 'signup_closed' });
    expect(decideAccess({ ...base, signupOpen: false, existingMember: true })).toEqual({ ok: true, role: 'member' });
  });
  it('makes nobody an admin when no admins are configured', () => {
    expect(decideAccess({ ...base, adminEmails: [] })).toEqual({ ok: true, role: 'member' });
    expect(decideAccess({ ...base, adminEmails: [], intent: 'admin' })).toEqual({ ok: false, reason: 'not_admin' });
  });
});

describe('signed tokens', () => {
  it('round-trips and expires', () => {
    const t = signToken('user', { email: 'a@b.co', role: 'member' }, SECRET, 60, 1_000_000);
    expect(verifyToken<{ email: string }>('user', t, SECRET, 1_030_000)?.email).toBe('a@b.co');
    expect(verifyToken('user', t, SECRET, 1_061_000)).toBeNull();
  });
  it('cannot be replayed for a different purpose, secret or after tampering', () => {
    const t = signToken('oauth', { v: 'verifier' }, SECRET, 60);
    expect(verifyToken('user', t, SECRET)).toBeNull();
    expect(verifyToken('oauth', t, 'y'.repeat(40))).toBeNull();
    const [payload, sig] = t.split('.');
    const forged = `${Buffer.from(JSON.stringify({ role: 'admin', exp: 9_999_999_999 })).toString('base64url')}.${sig}`;
    expect(verifyToken('user', forged, SECRET)).toBeNull();
    expect(verifyToken('oauth', `${payload}x.${sig}`, SECRET)).toBeNull();
    expect(verifyToken('oauth', 'garbage', SECRET)).toBeNull();
    expect(verifyToken('oauth', undefined, SECRET)).toBeNull();
  });
  it('refuses short secrets', () => {
    expect(() => signToken('user', {}, 'short', 60)).toThrow();
  });
});

describe('helpers', () => {
  it('builds a PKCE pair whose challenge is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = makePkce();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
  it('builds the authorize URL', () => {
    const u = new URL(buildAuthorizeUrl('https://x.supabase.co/', 'google', 'https://site.in/api/auth/callback', 'abc'));
    expect(u.pathname).toBe('/auth/v1/authorize');
    expect(u.searchParams.get('provider')).toBe('google');
    expect(u.searchParams.get('redirect_to')).toBe('https://site.in/api/auth/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('s256');
  });
  it('only redirects to known in-site paths', () => {
    expect(safeNext('/admin', '/account')).toBe('/admin');
    expect(safeNext('https://evil.example', '/account')).toBe('/account');
    expect(safeNext('//evil.example', '/account')).toBe('/account');
    expect(safeNext(undefined, '/account')).toBe('/account');
  });
  it('parses the provider list, always including Google and ignoring unknown names', () => {
    expect(parseProviders(undefined)).toEqual(['google']);
    expect(parseProviders('github, GOOGLE, myspace')).toEqual(['google', 'github']);
    expect(parseProviders('')).toEqual(['google']);
    expect(parseProviders('github')).toEqual(['google', 'github']);
  });
});
