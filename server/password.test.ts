import { describe, expect, it } from 'vitest';
import { cleanEmail, cleanName, passwordProblem } from './password.js';

describe('passwordProblem', () => {
  it('accepts a reasonable password when the confirmation matches', () => {
    expect(passwordProblem('Tulsi2026!', 'Tulsi2026!', 'a@b.co')).toBeNull();
  });
  it('rejects short, letter-only, number-only, common and email-equal passwords', () => {
    expect(passwordProblem('a1', 'a1')).toMatch(/at least 8/i);
    expect(passwordProblem('abcdefghij', 'abcdefghij')).toMatch(/letter and one number/i);
    expect(passwordProblem('1234567890', '1234567890')).toMatch(/letter and one number/i);
    expect(passwordProblem('Password1', 'Password1')).toMatch(/common/i);
    expect(passwordProblem('me@site.co1', 'me@site.co1', 'ME@site.co1')).toMatch(/email/i);
  });
  it('rejects a mismatched confirmation and non-strings', () => {
    expect(passwordProblem('Tulsi2026!', 'Tulsi2026?')).toMatch(/do not match/i);
    expect(passwordProblem(undefined, undefined)).toBeTruthy();
  });
  it('rejects passwords over 72 bytes', () => {
    const long = 'a1' + 'x'.repeat(80);
    expect(passwordProblem(long, long)).toMatch(/too long/i);
  });
});

describe('cleanName / cleanEmail', () => {
  it('trims, collapses spaces and strips control characters and angle brackets', () => {
    expect(cleanName('  Asha   <b>Rao</b> ')).toBe('Asha bRao/b');
    expect(cleanName('A')).toBeNull();
    expect(cleanName('x'.repeat(101))).toBeNull();
    expect(cleanName(42)).toBeNull();
  });
  it('lowercases and validates emails', () => {
    expect(cleanEmail('  Asha@Example.COM ')).toBe('asha@example.com');
    expect(cleanEmail('not-an-email')).toBeNull();
    expect(cleanEmail('a b@c.com')).toBeNull();
    expect(cleanEmail('a@b')).toBeNull();
  });
});
