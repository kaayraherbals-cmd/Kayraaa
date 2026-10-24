import { describe, expect, it } from 'vitest';
import { cleanPage, validateIssue, validateIssueUpdate } from './issues.js';

const good = { category: 'broken', summary: 'Sign in button does nothing', details: 'I press it and the page stays the same.' };

describe('validateIssue', () => {
  it('accepts a report without an email', () => {
    const r = validateIssue(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe('');
  });
  it('rejects a missing category and short text', () => {
    const r = validateIssue({ category: 'nope', summary: 'x', details: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['category', 'details', 'summary']);
  });
  it('needs consent only when an email is given', () => {
    const noConsent = validateIssue({ ...good, email: 'a@b.com' });
    expect(noConsent.ok).toBe(false);
    if (!noConsent.ok) expect(noConsent.errors.consent).toBeTruthy();
    expect(validateIssue({ ...good, email: 'A@B.com', consent: true }).ok).toBe(true);
    expect(validateIssue({ ...good, email: 'not-an-email', consent: true }).ok).toBe(false);
  });
  it('keeps only well-formed codes and references', () => {
    const r = validateIssue({ ...good, errorCode: 'KH-AUTH-001', ref: 'R-7K2M9QXA' });
    expect(r.ok && r.value.errorCode).toBe('KH-AUTH-001');
    expect(r.ok && r.value.ref).toBe('R-7K2M9QXA');
    const bad = validateIssue({ ...good, errorCode: '<script>', ref: 'whatever' });
    expect(bad.ok && bad.value.errorCode).toBe('');
    expect(bad.ok && bad.value.ref).toBe('');
  });
});

describe('cleanPage', () => {
  it('keeps a site path and drops the query, fragment and other hosts', () => {
    expect(cleanPage('/login?token=abc#x')).toBe('/login');
    expect(cleanPage('https://evil.example/x')).toBe('');
    expect(cleanPage('//evil.example')).toBe('');
    expect(cleanPage(42)).toBe('');
  });
});

describe('validateIssueUpdate', () => {
  it('accepts valid fields and rejects the rest', () => {
    expect(validateIssueUpdate({ status: 'resolved', severity: 'high', admin_note: ' fixed ' })).toEqual({ ok: true, update: { status: 'resolved', severity: 'high', admin_note: 'fixed' } });
    expect(validateIssueUpdate({ status: 'bogus' }).ok).toBe(false);
    expect(validateIssueUpdate({}).ok).toBe(false);
  });
});
