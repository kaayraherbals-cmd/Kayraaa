import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatRupees } from '../../shared/cart';
import type { PublicBundle } from '../../shared/bundleView';
import { useNoIndex } from '../lib/auth';
import { useCart } from '../lib/cart';
import { errorInfo, networkError } from '../lib/errors';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; bundles: PublicBundle[] };

/** Bundles and gift sets: components, live price, the real saving and availability. Read only: ordering a bundle opens in a later release. */
export default function Bundles() {
  useNoIndex('Bundles | Kaayra Herbals');
  const { enabled } = useCart();
  const [s, setS] = useState<State>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/cart/bundles', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        const data = (await res.json().catch(() => null)) as { bundles?: PublicBundle[] } | null;
        if (!live) return;
        setS(res.ok && Array.isArray(data?.bundles) ? { status: 'ready', bundles: data.bundles } : { status: 'error', message: errorInfo(data).message });
      } catch {
        if (live) setS({ status: 'error', message: networkError().message });
      }
    })();
    return () => { live = false; };
  }, [enabled]);

  return (
    <section className="section bag-section">
      <div className="wrap cart-page">
        <header className="bag-head">
          <p className="eyebrow">Sets and kits</p>
          <h1>Bundles</h1>
        </header>
        {!enabled ? (
          <p className="lede">Nothing is for sale yet. <Link className="link-arrow" to="/#notify">Join the launch list</Link> and we will tell you first.</p>
        ) : s.status === 'loading' ? (
          <p className="lede" role="status">Loading bundles…</p>
        ) : s.status === 'error' ? (
          <p className="form-status form-status--error" role="alert">{s.message}</p>
        ) : s.bundles.length === 0 ? (
          <p className="lede">There are no bundles right now. <Link className="link-arrow" to="/collection">Browse the shop</Link></p>
        ) : (
          <>
            <p className="field-hint">Ordering a bundle opens in a later release. You can add the single products to your bag today.</p>
            <ul className="wish-list">
              {s.bundles.map((b) => (
                <li key={b.slug} className="wish-row">
                  <div>
                    <h2 className="wish-name">{b.name}</h2>
                    {b.description && <p>{b.description}</p>}
                    <ul className="bundle-parts">{b.components.map((c, i) => <li key={i}>{c.qty} × {c.product} ({c.packSize})</li>)}</ul>
                    <p className="wish-meta">
                      <strong>{formatRupees(b.finalPaise)}</strong> instead of {formatRupees(b.combinedPaise)}: you save {formatRupees(b.savingsPaise)} · <span data-state={b.available > 0 ? 'in_stock' : 'out_of_stock'}>{b.available > 0 ? 'Available' : 'Currently unavailable'}</span>
                    </p>
                    {b.giftNote && <p className="wish-meta">{b.giftNote}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
