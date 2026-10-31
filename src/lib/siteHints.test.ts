import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSiteHintsForTests, setHint } from './siteHints';

/** A tiny in-memory stand-in for the browser's window and localStorage (the test environment is Node). */
function fakeBrowser(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set('kaayra-site-hints-v1', initial);
  const listeners: Array<(e: { key: string | null; newValue: string | null }) => void> = [];
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    addEventListener: (_: string, fn: (e: { key: string | null; newValue: string | null }) => void) => void listeners.push(fn),
    removeEventListener: () => undefined,
  });
  return store;
}

const saved = (store: Map<string, string>) => JSON.parse(store.get('kaayra-site-hints-v1') ?? 'null') as Record<string, unknown> | null;

beforeEach(() => resetSiteHintsForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('remembered shop state', () => {
  it('stores a fresh answer with a timestamp, and nothing personal', () => {
    const store = fakeBrowser();
    setHint('shop', { has: true, sale: false });
    setHint('aiOn', true);
    setHint('cartOpen', false);
    const s = saved(store);
    expect(s).toMatchObject({ shop: { has: true, sale: false }, aiOn: true, cartOpen: false });
    expect(typeof s?.at).toBe('number');
    expect(Object.keys(s ?? {}).sort()).toEqual(['aiOn', 'at', 'cartOpen', 'shop']);
  });

  it('does not write again when the answer is unchanged', () => {
    const store = fakeBrowser();
    setHint('aiOn', true);
    const first = store.get('kaayra-site-hints-v1');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    setHint('aiOn', true);
    expect(store.get('kaayra-site-hints-v1')).toBe(first);
  });

  it('keeps working when storage is blocked (private mode)', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    expect(() => setHint('aiOn', true)).not.toThrow();
  });

  it('does nothing on the server, where there is no window', () => {
    vi.stubGlobal('window', undefined);
    expect(() => setHint('aiOn', true)).not.toThrow();
  });

  it('merges with what an earlier visit left, and ignores a record that is too old or malformed', () => {
    const fresh = fakeBrowser(JSON.stringify({ at: Date.now() - 1000, cartOpen: true, aiOn: 'yes' }));
    setHint('shop', { has: false, sale: false });
    expect(saved(fresh)).toMatchObject({ cartOpen: true, shop: { has: false, sale: false } });
    expect(saved(fresh)).not.toHaveProperty('aiOn'); // a non-boolean value is dropped, not trusted

    resetSiteHintsForTests();
    const old = fakeBrowser(JSON.stringify({ at: Date.now() - 15 * 24 * 60 * 60 * 1000, cartOpen: true }));
    setHint('aiOn', false);
    expect(saved(old)).not.toHaveProperty('cartOpen');

    resetSiteHintsForTests();
    const junk = fakeBrowser('not json');
    setHint('aiOn', true);
    expect(saved(junk)).toMatchObject({ aiOn: true });
  });
});
