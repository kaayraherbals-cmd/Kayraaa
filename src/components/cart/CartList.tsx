import { useCart } from '../../lib/cart';
import CartItem from './CartItem';
import CartSummary from './CartSummary';
import EmptyCart from './EmptyCart';
import ErrorNotice from '../ErrorNotice';

/** The bag contents with all its states (loading, error, empty, items). Shared by the drawer and the bag page. */
export default function CartList({ onNavigate }: { onNavigate?: () => void }) {
  const { status, view, busy, error, notice, setQty, remove, refresh } = useCart();

  if (status === 'loading') {
    return (
      <div className="cart-loading" role="status" aria-busy="true" aria-label="Loading your bag">
        <span className="skel skel--line" />
        <span className="skel skel--line skel--short" />
        <span className="skel skel--line" />
      </div>
    );
  }
  if (status === 'error' && error) {
    return (
      <div className="cart-failure">
        <ErrorNotice error={error} />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refresh()}>Try again</button>
      </div>
    );
  }
  if (view.lines.length === 0) return <EmptyCart onNavigate={onNavigate} />;

  return (
    <div className="cart-body" aria-busy={busy}>
      {error && <ErrorNotice error={error} />}
      <ul className="cart-items">
        {view.lines.map((l) => (
          <CartItem key={l.variantId} line={l} busy={busy} onQty={(id, q) => void setQty(id, q)} onRemove={(id) => void remove(id)} />
        ))}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">{notice ?? ''}</p>
      <CartSummary view={view} onNavigate={onNavigate} />
    </div>
  );
}
