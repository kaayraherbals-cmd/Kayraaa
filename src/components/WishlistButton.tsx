import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { useWishlist } from '../lib/wishlist';

/** Save / saved control for a product page. Shown only where the bag is open. Signed-out visitors are sent to sign in and come back. */
export default function WishlistButton({ slug, productName }: { slug: string; productName: string }) {
  const { enabled } = useCart();
  const w = useWishlist();
  if (!enabled) return null;
  if (!w.signedIn) {
    return (
      <p className="wish-line">
        <Link className="btn btn--ghost" to={`/login?return=/collection/${slug}`}>Sign in to save<span className="sr-only"> {productName} to your wishlist</span></Link>
      </p>
    );
  }
  const saved = w.has(slug);
  return (
    <div className="wish-line">
      <button type="button" className="btn btn--ghost" aria-pressed={saved} disabled={w.busy === slug} onClick={() => void (saved ? w.remove(slug) : w.add(slug))}>
        {w.busy === slug ? 'Saving…' : saved ? 'Saved to wishlist' : 'Save to wishlist'}
        <span className="sr-only">: {productName}</span>
      </button>
      {saved && <Link className="link-arrow" to="/wishlist">View wishlist</Link>}
      {w.message && <p className="form-status form-status--error" role="alert">{w.message}</p>}
    </div>
  );
}
