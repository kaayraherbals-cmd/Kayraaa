import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import CartList from '../components/cart/CartList';
import { cartApi } from '../lib/cartApi';
import { useCart } from '../lib/cart';
import { useNoIndex } from '../lib/auth';

const PENDING = 'kaayra-recover';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Full-page bag: items on the left, a sticky summary on the right (desktop). Without the bag it says so plainly. */
export default function Bag() {
  useNoIndex('Your bag | Kaayra Herbals');
  const { enabled, itemCount, refresh } = useCart();
  const [params, setParams] = useSearchParams();
  const [recoverNote, setRecoverNote] = useState<{ text: string; signIn: boolean } | null>(null);
  const handled = useRef(false);

  // A link from a reminder email arrives as /bag?recover=<token>. The token is taken out of the address bar at once, checked by the
  // server for the signed-in customer, and the bag shown is the customer's own saved bag, re-priced from live data.
  // If nobody is signed in, the token waits in this tab (sessionStorage) until they have signed in and come back to /bag.
  useEffect(() => {
    if (handled.current || !enabled) return;
    const fromUrl = params.get('recover');
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(PENDING);
    } catch {
      /* storage can be blocked; the link then works only while signed in */
    }
    const token = fromUrl && TOKEN_RE.test(fromUrl) ? fromUrl : stored && TOKEN_RE.test(stored) ? stored : null;
    if (fromUrl) setParams({}, { replace: true });
    if (!token) return;
    handled.current = true;
    void cartApi.recover(token).then((r) => {
      try {
        if (r.result === 'signin_required') window.sessionStorage.setItem(PENDING, token);
        else window.sessionStorage.removeItem(PENDING);
      } catch {
        /* ignore */
      }
      if (r.result === 'ok') void refresh();
      else setRecoverNote({ text: r.message, signIn: r.result === 'signin_required' || r.result === 'wrong_account' });
    });
  }, [enabled, params, setParams, refresh]);

  return (
    <section className="section bag-section">
      <div className="wrap cart-page">
        <header className="bag-head">
          <p className="eyebrow">{enabled && itemCount > 0 ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : 'Your selections'}</p>
          <h1>Your bag</h1>
        </header>
        {recoverNote && (
          <p className="form-status form-status--info" role="status">
            {recoverNote.text} {recoverNote.signIn && <Link to="/login?return=/bag">Sign in</Link>}
          </p>
        )}
        {enabled ? (
          <CartList />
        ) : (
          <p className="lede">
            Nothing is for sale yet, so there is no bag. <Link className="link-arrow" to="/#notify">Join the launch list</Link> and we will tell you first.
          </p>
        )}
      </div>
    </section>
  );
}
