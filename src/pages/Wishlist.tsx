import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatRupees } from '../../shared/cart';
import { wishStateLabel } from '../../shared/wishlist';
import { useNoIndex } from '../lib/auth';
import { useCart } from '../lib/cart';
import { useWishlist } from '../lib/wishlist';
import { wishlistApi } from '../lib/wishlistApi';

/** The signed-in customer's wishlist: current price and availability from the server, remove, and add to bag. */
export default function Wishlist() {
  useNoIndex('Your wishlist | Kaayra Herbals');
  const { enabled, refresh, openDrawer } = useCart();
  const w = useWishlist();
  const [note, setNote] = useState<{ slug: string; text: string } | null>(null);

  async function toBag(slug: string) {
    setNote(null);
    const r = await wishlistApi.toCart(slug);
    if (r.ok) {
      await refresh();
      openDrawer();
    } else if (r.code === 'choose_size') setNote({ slug, text: 'This product comes in more than one size. Choose a size on its page.' });
    else setNote({ slug, text: r.message ?? r.error.message });
  }

  let body;
  if (!enabled) {
    body = <p className="lede">Nothing is for sale yet, so there is no wishlist. <Link className="link-arrow" to="/#notify">Join the launch list</Link> and we will tell you first.</p>;
  } else if (!w.signedIn) {
    body = <p className="lede">Sign in to see the products you saved. <Link className="link-arrow" to="/login?return=/wishlist">Sign in</Link></p>;
  } else if (w.status === 'idle' || w.status === 'loading') {
    body = <p className="lede" role="status">Loading your wishlist…</p>;
  } else if (w.status === 'error') {
    body = (
      <p className="form-status form-status--error" role="alert">
        {w.message ?? 'We could not load your wishlist.'} <button type="button" className="link-arrow" onClick={() => void w.reload()}>Try again</button>
      </p>
    );
  } else if (!w.items.length) {
    body = <p className="lede">Your wishlist is empty. Save a product from its page and it will wait here. <Link className="link-arrow" to="/collection">Browse the shop</Link></p>;
  } else {
    body = (
      <ul className="wish-list">
        {w.items.map((i) => (
          <li key={i.slug} className="wish-row">
            <div>
              <h2 className="wish-name"><Link to={`/collection/${i.slug}`}>{i.name}</Link></h2>
              <p className="wish-meta">
                {i.fromPaise != null && <span>From {formatRupees(i.fromPaise)} · </span>}
                <span data-state={i.state}>{wishStateLabel(i.state)}</span>
              </p>
              {note?.slug === i.slug && <p className="form-status form-status--info" role="status">{note.text}</p>}
            </div>
            <div className="wish-actions">
              <button type="button" className="btn" disabled={i.state !== 'in_stock'} onClick={() => void toBag(i.slug)}>Add to bag<span className="sr-only">: {i.name}</span></button>
              <button type="button" className="btn btn--ghost" disabled={w.busy === i.slug} onClick={() => void w.remove(i.slug)}>Remove<span className="sr-only">: {i.name}</span></button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="section bag-section">
      <div className="wrap cart-page">
        <header className="bag-head">
          <p className="eyebrow">{enabled && w.signedIn && w.status === 'ready' ? `${w.count} ${w.count === 1 ? 'product' : 'products'}` : 'Saved for later'}</p>
          <h1>Your wishlist</h1>
        </header>
        {body}
      </div>
    </section>
  );
}
