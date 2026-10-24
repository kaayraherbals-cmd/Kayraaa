import { useCart } from '../../lib/cart';
import { IconBag } from '../Icons';

/** Header Bag button: opens the bag drawer. Renders nothing unless the bag is open on this deployment. */
export default function CartBadge() {
  const { enabled, itemCount, openDrawer, drawerOpen } = useCart();
  if (!enabled) return null;
  return (
    <button type="button" className="tool cart-badge" onClick={openDrawer} aria-haspopup="dialog" aria-expanded={drawerOpen} aria-label={itemCount === 1 ? 'Bag, 1 item' : `Bag, ${itemCount} items`}>
      <IconBag />
      <span className="tool-label" aria-hidden="true">Bag</span>
      {itemCount > 0 && <span className="cart-badge-count" aria-hidden="true">{itemCount}</span>}
    </button>
  );
}
