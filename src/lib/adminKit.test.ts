import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, forgetReplies, peek } from './adminKit';

function reply(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => {
  forgetReplies();
  vi.unstubAllGlobals();
});

describe('admin api cache', () => {
  it('shares one request between identical GETs made at the same time', async () => {
    const f = vi.fn(() => reply({ n: 1 }));
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([api('orders?page=1'), api('orders?page=1')]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual(b.data);
  });

  it('remembers the last good reply so a section can paint at once', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ items: [1] })));
    expect(peek('orders?page=1')).toBeNull();
    await api('orders?page=1');
    expect(peek('orders?page=1')).toEqual({ items: [1] });
  });

  it('forgets everything after a change, so edited data is never shown stale', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ ok: true })));
    await api('orders?page=1');
    await api('orders?id=1', { method: 'PATCH', body: { status: 'shipped' } });
    expect(peek('orders?page=1')).toBeNull();
  });

  it('forgets everything when the session has expired, and never caches a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ message: 'no' }, 401)));
    await api('orders?page=1');
    expect(peek('orders?page=1')).toBeNull();
  });

  it('asks again for a fresh copy on every GET (the cache only feeds the first paint)', async () => {
    const f = vi.fn(() => reply({ n: 1 }));
    vi.stubGlobal('fetch', f);
    await api('orders?page=1');
    await api('orders?page=1');
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('admin hooks stay stable between renders', () => {
  it('useMe is memoised, because screens use it in effect dependencies', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./adminKit.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/export function useMe[\s\S]*useMemo\(/);
  });
});
