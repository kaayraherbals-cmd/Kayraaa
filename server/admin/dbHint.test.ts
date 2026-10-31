import { describe, expect, it } from 'vitest';
import { dbHint } from './dbHint.js';

describe('dbHint', () => {
  it('points a missing table at its SQL file', () => {
    expect(dbHint(new Error('count order_refunds 404'))).toContain('supabase/refunds.sql');
    expect(dbHint(new Error('members 404'))).toContain('auth_members.sql');
  });
  it('explains a column mismatch, a rejected key and an unreachable database', () => {
    expect(dbHint(new Error('orders 400'))).toContain('column');
    expect(dbHint(new Error('issues 401'))).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(dbHint(new TypeError('fetch failed'))).toContain('SUPABASE_URL');
  });
  it('never echoes a secret', () => {
    expect(dbHint(new Error('orders 404 key=abc123'))).not.toContain('abc123');
  });
});
