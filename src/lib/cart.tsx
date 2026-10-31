import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CART_MAX_QTY, parseLines, type CartLineInput } from '../../shared/cart';
import { cartApi, EMPTY_VIEW, type CartResult, type CartView } from './cartApi';
import type { ErrorInfo } from './errors';
import { useSession } from './session';
import { setHint } from './siteHints';

/**
 * Shopping bag state (development preview). Inert unless the server says the preview is open.
 *  - Signed in: the bag lives on the server; this only holds the last priced copy it returned.
 *  - Guest: only variant ids and quantities are kept in this browser (localStorage), and every display re-prices them on
 *    the server. Prices and stock are never stored here. After sign-in the guest lines are merged into the saved bag once.
 * Operations run one at a time, so a double tap cannot send the same change twice.
 */
const STORAGE_KEY = 'kaayra.bag.v1';

export function readGuestLines(): CartLineInput[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = parseLines(JSON.parse(raw));
    return parsed.ok ? parsed.lines : [];
  } catch {
    return [];
  }
}

function writeGuestLines(lines: CartLineInput[]) {
  try {
    if (lines.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode): the bag simply will not survive a reload */
  }
}

export type CartStatus = 'off' | 'loading' | 'ready' | 'error';

interface CartState {
  enabled: boolean;
  status: CartStatus;
  view: CartView;
  busy: boolean;
  error: ErrorInfo | null;
  /** A short, polite announcement for screen readers, such as "Added to your bag". */
  notice: string | null;
  itemCount: number;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  add: (variantId: string, qty: number) => Promise<boolean>;
  setQty: (variantId: string, qty: number) => Promise<void>;
  remove: (variantId: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Puts a code on the bag. Resolves to null on success, or the reason in plain words. The server decides; nothing is calculated here. */
  applyCoupon: (code: string) => Promise<string | null>;
  removeCoupon: () => Promise<void>;
}

const noop = async () => {};
const Ctx = createContext<CartState>({
  enabled: false, status: 'off', view: EMPTY_VIEW, busy: false, error: null, notice: null, itemCount: 0, drawerOpen: false,
  openDrawer: () => {}, closeDrawer: () => {}, add: async () => false, setQty: noop, remove: noop, refresh: noop,
  applyCoupon: async () => 'Coupons are not available right now.', removeCoupon: noop,
});

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<CartStatus>('off');
  const [view, setView] = useState<CartView>(EMPTY_VIEW);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const viewRef = useRef<CartView>(EMPTY_VIEW);
  viewRef.current = view;

  // Ask the server once whether the preview is open. Closed (the normal case) means nothing below ever runs.
  useEffect(() => {
    let live = true;
    void cartApi.enabledKnown().then((known) => {
      if (known !== null) setHint('cartOpen', known); // remembered for the next visit (see siteHints.ts); a network blip is not
      if (!live) return;
      const on = known === true;
      setEnabled(on);
      setStatus(on ? 'loading' : 'off');
    });
    return () => {
      live = false;
    };
  }, []);

  /** Runs one operation after the previous one has finished. */
  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    const run = chain.current.then(fn, fn).finally(() => setPending((n) => n - 1));
    chain.current = run.catch(() => undefined);
    return run;
  }, []);

  const apply = useCallback((r: CartResult<CartView>): boolean => {
    if (r.ok) {
      setView(r.data);
      setStatus('ready');
      setError(null);
      return true;
    }
    setError(r.error);
    setStatus((s) => (s === 'loading' ? 'error' : s));
    return false;
  }, []);

  const signedIn = user === undefined ? undefined : Boolean(user);
  const userKey = user === undefined ? 'pending' : user ? user.email : 'guest';

  const load = useCallback(async () => {
    if (signedIn === undefined) return;
    if (signedIn) {
      const guest = readGuestLines();
      if (guest.length) {
        const merged = await cartApi.merge(guest);
        if (merged.ok) writeGuestLines([]);
        apply(merged);
        return;
      }
      apply(await cartApi.view());
      return;
    }
    const lines = readGuestLines();
    if (!lines.length) {
      setView(EMPTY_VIEW);
      setStatus('ready');
      return;
    }
    apply(await cartApi.validate(lines));
  }, [signedIn, apply]);

  useEffect(() => {
    if (!enabled || userKey === 'pending') return;
    void enqueue(load);
  }, [enabled, userKey, load, enqueue]);

  // Prices and stock can change while a tab sits open, so re-check when the person comes back to it.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void enqueue(load);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, load, enqueue]);

  const change = useCallback(
    (variantId: string, wanted: (current: number) => number, doneNotice: string): Promise<boolean> =>
      enqueue(async () => {
        if (!enabled || signedIn === undefined) return false;
        setNotice(null);
        const current = (list: { variantId: string; requestedQty: number }[]) => list.find((l) => l.variantId === variantId)?.requestedQty ?? 0;
        let ok: boolean;
        if (signedIn) {
          const qty = Math.max(0, Math.min(CART_MAX_QTY, wanted(current(viewRef.current.lines))));
          ok = apply(await cartApi.set(variantId, qty));
        } else {
          const lines = readGuestLines();
          const qty = Math.max(0, Math.min(CART_MAX_QTY, wanted(lines.find((l) => l.variantId === variantId)?.qty ?? 0)));
          const next = lines.filter((l) => l.variantId !== variantId);
          if (qty > 0) next.push({ variantId, qty });
          const r = await cartApi.validate(next);
          ok = apply(r);
          // Only keep what the server accepted, so storage never holds something it rejected.
          if (ok) writeGuestLines(next);
        }
        if (ok) setNotice(doneNotice);
        return ok;
      }),
    [enabled, signedIn, apply, enqueue],
  );

  const add = useCallback((variantId: string, qty: number) => change(variantId, (c) => c + qty, 'Added to your bag.'), [change]);
  const setQty = useCallback(async (variantId: string, qty: number) => void (await change(variantId, () => qty, qty > 0 ? 'Quantity updated.' : 'Removed from your bag.')), [change]);
  const remove = useCallback(async (variantId: string) => void (await change(variantId, () => 0, 'Removed from your bag.')), [change]);
  const refresh = useCallback(() => enqueue(load), [enqueue, load]);
  const applyCoupon = useCallback(
    (code: string): Promise<string | null> =>
      enqueue(async () => {
        const r = await cartApi.applyCoupon(code);
        if (r.ok) {
          apply(r);
          setNotice('Coupon applied.');
          return null;
        }
        return r.status === 401 ? 'Sign in to use a coupon.' : r.error.message;
      }),
    [enqueue, apply],
  );
  const removeCoupon = useCallback(async () => {
    await enqueue(async () => {
      const r = await cartApi.removeCoupon();
      if (apply(r)) setNotice('Coupon removed.');
    });
  }, [enqueue, apply]);
  // Stable identities: the drawer's effects depend on these, so they must not change when the bag does.
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const value = useMemo<CartState>(
    () => ({
      enabled, status, view, busy: pending > 0, error, notice, itemCount: view.totals.itemCount, drawerOpen,
      openDrawer, closeDrawer, add, setQty, remove, refresh, applyCoupon, removeCoupon,
    }),
    [enabled, status, view, pending, error, notice, drawerOpen, openDrawer, closeDrawer, add, setQty, remove, refresh, applyCoupon, removeCoupon],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCart = () => useContext(Ctx);
