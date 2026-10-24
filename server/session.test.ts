import { describe, expect, it } from 'vitest';
import { isAdminEmail, parseAdminEmails, signSession, verifySession } from './session.js';

const SECRET = 'x'.repeat(40);
const NOW = 1_800_000_000_000;

describe('admin session tokens', () => {
  it('round-trips a valid token', () => {
    const t = signSession('Admin@Example.com', SECRET, NOW);
    expect(verifySession(t, SECRET, NOW + 1000)?.email).toBe('admin@example.com');
  });

  it('rejects expired tokens', () => {
    const t = signSession('a@b.co', SECRET, NOW, 60);
    expect(verifySession(t, SECRET, NOW + 61_000)).toBeNull();
  });

  it('rejects tampered payloads, wrong secrets and malformed tokens', () => {
    const t = signSession('a@b.co', SECRET, NOW);
    const [, sig] = t.split('.');
    const forged = `${Buffer.from(JSON.stringify({ email: 'evil@x.co', exp: 9_999_999_999 })).toString('base64url')}.${sig}`;
    expect(verifySession(forged, SECRET, NOW)).toBeNull();
    expect(verifySession(t, 'y'.repeat(40), NOW)).toBeNull();
    expect(verifySession('garbage', SECRET, NOW)).toBeNull();
    expect(verifySession(undefined, SECRET, NOW)).toBeNull();
  });

  it('refuses short secrets', () => {
    expect(() => signSession('a@b.co', 'short', NOW)).toThrow();
    expect(verifySession('a.b', 'short', NOW)).toBeNull();
  });

  it('matches the admin allowlist case-insensitively', () => {
    const list = parseAdminEmails(' Boss@Kaayra.in , second@kaayra.in ,');
    expect(list).toEqual(['boss@kaayra.in', 'second@kaayra.in']);
    expect(isAdminEmail('BOSS@kaayra.in', list)).toBe(true);
    expect(isAdminEmail('intruder@kaayra.in', list)).toBe(false);
    expect(isAdminEmail('anything', [])).toBe(false);
  });

  it('carries the two-step claim and defaults to none', () => {
    expect(verifySession(signSession('a@b.co', SECRET, NOW), SECRET, NOW)?.mfa).toBe(0);
    expect(verifySession(signSession('a@b.co', SECRET, NOW, 3600, 1_790_000_000), SECRET, NOW)?.mfa).toBe(1_790_000_000);
    const [payload, sig] = signSession('a@b.co', SECRET, NOW).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), mfa: 5 })).toString('base64url');
    expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });
});
