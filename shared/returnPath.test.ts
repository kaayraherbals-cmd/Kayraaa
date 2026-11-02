import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './returnPath.js';

describe('safeReturnPath', () => {
  it('accepts allow-listed same-site paths', () => {
    for (const v of ['/track-order', '/account', '/bag', '/checkout', '/track-order/7b3f6c1e-2a4d-4e8b-9c1a-0d2e3f4a5b6c']) expect(safeReturnPath(v)).toBe(v);
  });
  it('rejects everything else', () => {
    for (const v of ['//evil.test', 'https://evil.test', 'javascript:alert(1)', '/\\evil.test', '/track-order?x=1', '/admin', '/track-order/../admin', '', null, 5, '/account\n', '/a b']) expect(safeReturnPath(v)).toBeNull();
  });
});
