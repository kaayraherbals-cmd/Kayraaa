import { useCart } from '../../lib/cart';
import { IconBag } from '../Icons';
import { useT } from '../../i18n/I18nProvider';

/** Header Bag button: opens the bag drawer. Renders nothing unless the bag is open on this deployment. */
export default function CartBadge() {
  const { enabled, itemCount, openDrawer, drawerOpen } = useCart();
  const t = useT();
  if (!enabled) return null;
  return (
    <button type="button" className="tool cart-badge" onClick={openDrawer} aria-haspopup="dialog" aria-expanded={drawerOpen} aria-label={itemCount === 1 ? t('bagOne') : t('bagMany', { n: itemCount })}>
      <IconBag />
      <span className="tool-label" aria-hidden="true">{t('bag')}</span>
      {itemCount > 0 && <span key={itemCount} className="cart-badge-count" aria-hidden="true">{itemCount}</span>}
    </button>
  );
}
