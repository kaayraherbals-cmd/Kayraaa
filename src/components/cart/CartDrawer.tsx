import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '../../lib/cart';
import CartList from './CartList';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Slide-in bag. A modal dialog: focus moves in, Tab stays inside, Escape closes, and focus returns to the button that opened it. */
export default function CartDrawer() {
  const { enabled, drawerOpen, closeDrawer } = useCart();
  const { pathname } = useLocation();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  useEffect(() => {
    if (!drawerOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    document.documentElement.setAttribute('data-bag-open', '');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDrawer();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.removeAttribute('data-bag-open');
      opener?.focus?.();
    };
  }, [drawerOpen, closeDrawer]);

  if (!enabled) return null;
  return (
    <>
      <div className="cart-backdrop" data-open={drawerOpen} onClick={closeDrawer} aria-hidden="true" />
      <div ref={panel} className="cart-drawer" data-open={drawerOpen} role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title" hidden={!drawerOpen}>
        <div className="cart-drawer-head">
          <h2 id="cart-drawer-title" className="cart-title">Your bag</h2>
          <button ref={closeButton} type="button" className="cart-close" onClick={closeDrawer} aria-label="Close your bag"><span aria-hidden="true">×</span></button>
        </div>
        <div className="cart-drawer-body">
          <CartList onNavigate={closeDrawer} />
        </div>
        <p className="cart-drawer-foot"><Link to="/bag" onClick={closeDrawer}>View full bag</Link></p>
      </div>
    </>
  );
}
