import { describe, expect, it } from 'vitest';
import { deriveErrorCode, ERROR_CODE_RE, ERRORS, ISSUE_REF_RE, isErrorCode, makeIssueRef, makeRef, REF_RE } from './errors.js';

describe('error catalogue', () => {
  it('uses well-formed codes with a message and a fix for each', () => {
    for (const [code, def] of Object.entries(ERRORS)) {
      expect(code).toMatch(ERROR_CODE_RE);
      expect(def.message.length).toBeGreaterThan(8);
      expect(def.fix.length).toBeGreaterThan(8);
    }
  });
  it('makes unambiguous references', () => {
    for (let i = 0; i < 200; i++) {
      expect(makeRef()).toMatch(REF_RE);
      expect(makeIssueRef()).toMatch(ISSUE_REF_RE);
    }
    expect(makeRef()).not.toBe(makeRef());
  });
  it('recognises catalogue codes', () => {
    expect(isErrorCode('KH-AUTH-001')).toBe(true);
    expect(isErrorCode('KH-AUTH-999')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});

describe('deriveErrorCode', () => {
  it('maps sign-in responses', () => {
    expect(deriveErrorCode('AUTH', 401, { message: 'That email and password do not match.' })).toBe('KH-AUTH-001');
    expect(deriveErrorCode('AUTH', 403, { code: 'unverified', message: 'Please verify your email first.' })).toBe('KH-AUTH-002');
    expect(deriveErrorCode('AUTH', 429)).toBe('KH-AUTH-003');
    expect(deriveErrorCode('AUTH', 403, { message: 'We are not accepting new accounts right now.' })).toBe('KH-AUTH-004');
    expect(deriveErrorCode('AUTH', 401, { message: 'Sign in to continue.' })).toBe('KH-AUTH-005');
    expect(deriveErrorCode('AUTH', 400, { field: 'password', message: 'x' })).toBe('KH-AUTH-006');
    expect(deriveErrorCode('AUTH', 400, { field: 'email', message: 'x' })).toBe('KH-FORM-001');
    expect(deriveErrorCode('AUTH', 503)).toBe('KH-AUTH-010');
    expect(deriveErrorCode('AUTH', 502)).toBe('KH-AUTH-011');
    expect(deriveErrorCode('AUTH', 403, { message: 'Request not allowed.' })).toBe('KH-SYS-004');
  });
  it('maps admin, form and issue responses', () => {
    expect(deriveErrorCode('ADMIN', 401, { status: 'denied' })).toBe('KH-ADMIN-002');
    expect(deriveErrorCode('ADMIN', 401, { status: 'unauthorised' })).toBe('KH-ADMIN-003');
    expect(deriveErrorCode('ADMIN', 409)).toBe('KH-ADMIN-005');
    expect(deriveErrorCode('ADMIN', 403, { status: 'forbidden' })).toBe('KH-ADMIN-007');
    expect(deriveErrorCode('ADMIN', 403, { status: 'other' })).toBe('KH-SYS-004');
    expect(deriveErrorCode('ADMIN', 401, { status: 'mfa_required' })).toBe('KH-ADMIN-008');
    expect(deriveErrorCode('ADMIN', 409, { status: 'conflict' })).toBe('KH-ADMIN-009');
    expect(deriveErrorCode('ADMIN', 409, { status: 'commerce_off' })).toBe('KH-ADMIN-010');
    expect(deriveErrorCode('ADMIN', 401, { status: 'mfa_denied' })).toBe('KH-ADMIN-011');
    expect(deriveErrorCode('ADMIN', 503, { status: 'mfa_unavailable' })).toBe('KH-ADMIN-012');
    expect(deriveErrorCode('ADMIN', 503, { status: 'unconfigured' })).toBe('KH-ADMIN-001');
    expect(deriveErrorCode('FORM', 502)).toBe('KH-FORM-003');
    expect(deriveErrorCode('FORM', 503)).toBe('KH-FORM-002');
    expect(deriveErrorCode('CART', 404)).toBe('KH-CART-001');
    expect(deriveErrorCode('CART', 401)).toBe('KH-CART-002');
    expect(deriveErrorCode('CART', 400)).toBe('KH-CART-003');
    expect(deriveErrorCode('CART', 409)).toBe('KH-CART-004');
    expect(deriveErrorCode('CART', 429)).toBe('KH-CART-005');
    expect(deriveErrorCode('CART', 502)).toBe('KH-CART-006');
    expect(deriveErrorCode('ISSUE', 429)).toBe('KH-ISSUE-002');
    expect(deriveErrorCode('ISSUE', 500)).toBe('KH-SYS-001');
    expect(deriveErrorCode('ISSUE', 405)).toBe('KH-SYS-002');
  });
});
