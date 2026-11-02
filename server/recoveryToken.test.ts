import { describe, expect, it } from 'vitest';
import { signToken as launchSign } from './subscribeToken.js';
import { hashRestoreToken, isRestoreToken, newRestoreToken, oneClickUnsubscribeUrl, recoveryLinkConfig, restoreUrl, signUnsubscribeToken, unsubscribePageUrl, verifyUnsubscribeToken } from './recoveryToken.js';

const SECRET = 'recovery-unsub-secret-0123456789-abcdef-xyz';
const M = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('restore tokens', () => {
  it('are 43 characters of URL-safe base64 from 256 random bits and are unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const t = newRestoreToken().token;
      expect(isRestoreToken(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(2000);
  });
  it('store only a hash: 64 hex, deterministic, not the token', () => {
    const t = newRestoreToken();
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRestoreToken(t.token)).toBe(t.hash);
    expect(t.hash).not.toContain(t.token);
  });
  it('reject malformed, short, long and non-string input before any lookup', () => {
    for (const bad of ['', 'short', 'a'.repeat(44), 'a'.repeat(42) + '!', null, undefined, 12, { a: 1 }, "' or 1=1 --"]) expect(isRestoreToken(bad)).toBe(false);
  });
});

describe('unsubscribe tokens', () => {
  it('round-trip the member id and nothing else (no email)', () => {
    const t = signUnsubscribeToken(M, SECRET);
    expect(verifyUnsubscribeToken(t, SECRET)).toBe(M);
    expect(Buffer.from(t.split('.')[0]!, 'base64url').toString()).not.toContain('@');
  });
  it('fail when tampered, signed with another secret, or malformed', () => {
    const t = signUnsubscribeToken(M, SECRET);
    const [b, s] = t.split('.') as [string, string];
    const other = Buffer.from(JSON.stringify({ p: 'cart-unsub', m: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })).toString('base64url');
    expect(verifyUnsubscribeToken(`${other}.${s}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${b}.AAAA`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(t, SECRET + 'x')).toBeNull();
    expect(verifyUnsubscribeToken('nope', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(undefined, SECRET)).toBeNull();
  });
  it('a launch-list token can never be used here', () => {
    expect(verifyUnsubscribeToken(launchSign('unsubscribe', 'a@example.org', SECRET, 0), SECRET)).toBeNull();
  });
});

describe('link configuration', () => {
  it('needs a 32+ character secret and a real https address', () => {
    expect(recoveryLinkConfig({})).toBeNull();
    expect(recoveryLinkConfig({ SUBSCRIBE_TOKEN_SECRET: 'short', SITE_URL: 'https://kaayra.in' })).toBeNull();
    expect(recoveryLinkConfig({ SUBSCRIBE_TOKEN_SECRET: SECRET, SITE_URL: 'http://kaayra.in' })).toBeNull();
    expect(recoveryLinkConfig({ SUBSCRIBE_TOKEN_SECRET: SECRET, SITE_URL: 'https://site.example' })).toBeNull();
    expect(recoveryLinkConfig({ SUBSCRIBE_TOKEN_SECRET: SECRET, SITE_URL: 'https://localhost' })).toBeNull();
    expect(recoveryLinkConfig({ SUBSCRIBE_TOKEN_SECRET: SECRET, SITE_URL: 'https://kaayra.in/' })?.siteUrl).toBe('https://kaayra.in');
  });
  it('builds links that contain no email address', () => {
    const l = { siteUrl: 'https://kaayra.in', secret: SECRET };
    const t = newRestoreToken().token;
    for (const u of [restoreUrl(l, t), unsubscribePageUrl(l, M), oneClickUnsubscribeUrl(l, M)]) expect(u).not.toContain('@');
    expect(restoreUrl(l, t)).toBe(`https://kaayra.in/bag?recover=${t}`);
  });
});
