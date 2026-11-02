import { afterEach, describe, expect, it } from 'vitest';
import { rpc, safeDbError } from './rpc.js';

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

describe('database error logging', () => {
  it('keeps only the SQLSTATE and our own KH: codes', () => {
    expect(safeDbError({ code: '23514', message: 'new row for relation "orders" violates check constraint', details: 'Failing row contains (asha@example.org, 12 Lanka Road)' })).toBe('code=23514');
    expect(safeDbError({ code: 'P0001', message: 'KH:NEGATIVE_STOCK' })).toBe('code=P0001 KH:NEGATIVE_STOCK');
    expect(safeDbError('asha@example.org')).toBe('');
    expect(safeDbError(null)).toBe('');
  });
  it('never writes a failing row to the log', async () => {
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(' '));
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: '23514', message: 'violates check constraint', details: 'Failing row contains (asha@example.org, 12 Lanka Road)', hint: 'x' }), { status: 400 })) as typeof fetch;
    try {
      await rpc({ url: 'https://db.test', serviceKey: 'k' }, 'order_create', {});
    } finally {
      console.error = orig;
    }
    expect(logged.join(' ')).toContain('rpc order_create failed');
    expect(logged.join(' ')).not.toMatch(/asha@example\.org|Lanka|Failing row/);
  });
});
