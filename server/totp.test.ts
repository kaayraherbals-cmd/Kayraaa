import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  codeForStep,
  decryptSecret,
  encryptSecret,
  generateSecret,
  groupSecret,
  hashRecovery,
  looksLikeRecovery,
  makeRecoveryCodes,
  otpauthUri,
  stepAt,
  consumeRecoveryCode,
  verifyTotp,
} from './totp.js';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (the 8-digit values truncated to 6 digits).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const KEY = 'k'.repeat(40);

describe('TOTP (RFC 6238)', () => {
  it('matches the published test vectors', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [t, code] of vectors) expect(codeForStep(RFC_SECRET, stepAt(t * 1000))).toBe(code);
  });
  it('round-trips base32 and ignores spaces, dashes and case', () => {
    const bytes = Buffer.from('hello kaayra!');
    expect(base32Decode(base32Encode(bytes))?.toString()).toBe('hello kaayra!');
    expect(base32Decode(groupSecret(RFC_SECRET).toLowerCase())?.toString()).toBe('12345678901234567890');
    expect(base32Decode('not base32 !')).toBeNull();
    expect(base32Decode('')).toBeNull();
  });
  it('accepts the current code and one step of drift, nothing further', () => {
    const now = 1_800_000_000_000;
    const s = stepAt(now);
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, s), now)).toEqual({ ok: true, step: s });
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, s - 1), now)).toEqual({ ok: true, step: s - 1 });
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, s + 1), now)).toEqual({ ok: true, step: s + 1 });
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, s - 2), now).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, s + 2), now).ok).toBe(false);
  });
  it('refuses a code whose step was already used (replay)', () => {
    const now = 1_800_000_000_000;
    const s = stepAt(now);
    const code = codeForStep(RFC_SECRET, s);
    expect(verifyTotp(RFC_SECRET, code, now, s - 1).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now, s).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, code, now, s + 5).ok).toBe(false);
  });
  it('rejects malformed input', () => {
    const now = 1_800_000_000_000;
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5x']) expect(verifyTotp(RFC_SECRET, bad, now).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, ` ${codeForStep(RFC_SECRET, stepAt(now))} `, now).ok).toBe(true);
  });
  it('builds an otpauth link with the issuer and the secret', () => {
    const u = otpauthUri('boss@kaayra.in', RFC_SECRET);
    expect(u.startsWith('otpauth://totp/Kaayra%20Herbals%3Aboss%40kaayra.in?')).toBe(true);
    expect(u).toContain(`secret=${RFC_SECRET}`);
    expect(u).toContain('digits=6');
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe('secrets at rest', () => {
  it('encrypts and decrypts, with a fresh nonce each time', () => {
    const a = encryptSecret(RFC_SECRET, KEY);
    const b = encryptSecret(RFC_SECRET, KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain(RFC_SECRET);
    expect(decryptSecret(a, KEY)).toBe(RFC_SECRET);
  });
  it('fails closed on a wrong key, tampering or a short key', () => {
    const a = encryptSecret(RFC_SECRET, KEY);
    expect(decryptSecret(a, 'z'.repeat(40))).toBeNull();
    const parts = a.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(decryptSecret(parts.join('.'), KEY)).toBeNull();
    expect(decryptSecret('garbage', KEY)).toBeNull();
    expect(() => encryptSecret('x', 'short')).toThrow();
    expect(decryptSecret(a, 'short')).toBeNull();
  });
});

describe('recovery codes', () => {
  it('makes ten distinct well-formed codes', () => {
    const codes = makeRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it('accepts each code once, in any case or spacing, and never the hash itself', () => {
    const codes = makeRecoveryCodes(3);
    const hashes = codes.map((c) => hashRecovery(c, KEY));
    const afterFirst = consumeRecoveryCode(codes[1].toLowerCase().replace(/-/g, ' '), hashes, KEY);
    expect(afterFirst).toEqual([hashes[0], hashes[2]]);
    expect(consumeRecoveryCode(codes[1], afterFirst!, KEY)).toBeNull();
    expect(consumeRecoveryCode(hashes[0], hashes, KEY)).toBeNull();
    expect(consumeRecoveryCode('NOPE', hashes, KEY)).toBeNull();
    expect(looksLikeRecovery('AAAA-BBBB-CCCC')).toBe(true);
    expect(looksLikeRecovery('123456')).toBe(false);
  });
  it('hashes differently under a different key', () => {
    expect(hashRecovery('AAAA-BBBB-CCCC', KEY)).not.toBe(hashRecovery('AAAA-BBBB-CCCC', 'q'.repeat(40)));
  });
});
