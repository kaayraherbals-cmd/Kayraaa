import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatRupees } from '../../../shared/cart';
import { useCart } from '../../lib/cart';
import { cartApi, type VariantOption } from '../../lib/cartApi';
import { checkoutApi } from '../../lib/checkoutApi';

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; options: VariantOption[] };

/**
 * The purchase panel: price, availability, pack size, quantity, Add to bag, Buy now.
 * On phones a slim bar with the same action sticks to the bottom while the panel is scrolled out of view.
 * Prices, availability and limits come from the server for each option; nothing is priced here.
 */
export default function AddToBag({ slug, productName }: { slug: string; productName: string }) {
  const { enabled, add, busy, notice, openDrawer } = useCart();
  const [checkoutOpen, setCheckoutOpen] = useState<boolean | null>(null);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [chosen, setChosen] = useState('');
  const [qty, setQty] = useState(1);
  const [failed, setFailed] = useState(false);
  const [panelSeen, setPanelSeen] = useState(true);
  const [footerSeen, setFooterSeen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoad({ status: 'loading' });
    void cartApi.variants(slug).then((r) => {
      if (!live) return;
      if (!r.ok) return setLoad({ status: 'error' });
      setLoad({ status: 'ready', options: r.data.options });
      setChosen(r.data.options.find((o) => o.available)?.variantId ?? '');
    });
    return () => {
      live = false;
    };
  }, [enabled, slug]);

  // Ask the server whether orders can be placed, so the preview note is shown only when it is true.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void checkoutApi.config().then((c) => live && setCheckoutOpen(c.open));
    return () => {
      live = false;
    };
  }, [enabled]);

  // The sticky bar shows only while the real controls are off screen, and steps aside for the footer.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !panel.current) return;
    const a = new IntersectionObserver(([e]) => setPanelSeen(e.isIntersecting), { threshold: 0.05 });
    a.observe(panel.current);
    const foot = document.querySelector('.site-footer');
    const b = new IntersectionObserver(([e]) => setFooterSeen(e.isIntersecting));
    if (foot) b.observe(foot);
    return () => {
      a.disconnect();
      b.disconnect();
    };
  }, [load.status]);

  if (!enabled) return null;
  if (load.status === 'loading') return <div className="buy" aria-busy="true" role="status" aria-label="Loading purchase options"><span className="skel skel--line" /><span className="skel skel--line skel--short" /></div>;
  if (load.status === 'error') return <p className="buy-note">The bag is not available right now.</p>;

  const options = load.options;
  const current = options.find((o) => o.variantId === chosen);
  if (!options.some((o) => o.available)) {
    return (
      <div className="buy" role="status">
        <p className="buy-avail" data-tone="off"><span className="dot" aria-hidden="true" />Currently unavailable</p>
        <p className="buy-note">{options.find((o) => o.message)?.message ?? 'It cannot be added to a bag right now.'}</p>
        <p><Link className="link-arrow" to="/#notify">Tell me when it is back</Link></p>
      </div>
    );
  }

  const submit = async (buyNow = false) => {
    if (!current || busy) return;
    setFailed(false);
    const ok = await add(current.variantId, qty);
    setFailed(!ok);
    if (ok) {
      if (buyNow) navigate('/checkout');
      else openDrawer();
    }
  };
  const price = current?.unitPaise != null ? formatRupees(current.unitPaise) : null;
  const total = current?.unitPaise != null && qty > 1 ? formatRupees(current.unitPaise * qty) : null;
  const showBar = !panelSeen && !footerSeen;

  return (
    <>
      <div className="buy" ref={panel}>
        <div className="buy-top">
          <p className="buy-price">{price ?? '\u00a0'}{total && <span className="buy-total"> · {total} for {qty}</span>}</p>
          <p className="buy-avail" data-tone="ok"><span className="dot" aria-hidden="true" />In stock</p>
        </div>
        <p className="buy-tax">Inclusive of taxes. Delivery is calculated at checkout.</p>
        <fieldset className="sizes">
          <legend>Pack size</legend>
          {options.map((o) => (
            <label key={o.variantId} className="size-option" data-disabled={!o.available}>
              <input type="radio" name={`size-${slug}`} value={o.variantId} checked={chosen === o.variantId} disabled={!o.available} onChange={() => { setChosen(o.variantId); setQty(1); }} />
              <span className="size-label">{o.packSize}</span>
              <span className="size-price">{o.available && o.unitPaise !== null ? formatRupees(o.unitPaise) : (o.message ?? 'Unavailable')}</span>
            </label>
          ))}
        </fieldset>
        <div className="buy-row">
          <div className="cart-stepper" role="group" aria-label="Quantity">
            <button type="button" className="cart-step" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}><span aria-hidden="true">−</span></button>
            <output className="cart-qty" aria-live="polite">{qty}</output>
            <button type="button" className="cart-step" aria-label="Increase quantity" disabled={!current || qty >= current.maxQty} onClick={() => setQty((q) => Math.min(current?.maxQty ?? 1, q + 1))}><span aria-hidden="true">+</span></button>
          </div>
          <button type="button" className="btn buy-add" disabled={!current || busy} onClick={() => void submit()}>{busy ? 'Adding…' : 'Add to bag'}</button>
        </div>
        <button type="button" className="btn btn--ghost btn--block" disabled={!current || busy} onClick={() => void submit(true)}>Buy now</button>
        <p className="sr-only" role="status" aria-live="polite">{notice ?? ''}</p>
        {failed && <p className="buy-note" data-tone="bad" role="alert">We could not add that. Please try again.</p>}
        {checkoutOpen === false && <p className="buy-note">Preview only. Nothing is for sale yet, so you cannot place an order.</p>}
      </div>
      <div className="buy-bar" data-visible={showBar} aria-hidden={!showBar}>
        <div className="buy-bar-info">
          <span className="buy-bar-name">{productName}</span>
          <span className="buy-bar-sub">{current?.packSize}{price ? ` · ${price}` : ''}</span>
        </div>
        <button type="button" className="btn btn--gold" tabIndex={showBar ? 0 : -1} disabled={!current || busy} onClick={() => void submit()}>{busy ? 'Adding…' : 'Add to bag'}</button>
      </div>
    </>
  );
}
