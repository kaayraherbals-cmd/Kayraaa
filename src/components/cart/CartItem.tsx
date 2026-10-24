import type { CartLineView } from '../../../shared/cart';
import { formatRupees } from '../../../shared/cart';

interface Props {
  line: CartLineView;
  busy: boolean;
  onQty: (variantId: string, qty: number) => void;
  onRemove: (variantId: string) => void;
}

/** One line of the bag. Names, prices and limits all come from the server; this only displays them. */
export default function CartItem({ line, busy, onQty, onRemove }: Props) {
  const unavailable = line.state === 'unavailable';
  const label = `${line.productName}${line.packSize ? `, ${line.packSize}` : ''}`;
  return (
    <li className="cart-item" data-state={line.state}>
      <div className="cart-item-main">
        <p className="cart-item-name">{line.productName}</p>
        {line.packSize && <p className="cart-item-meta">{line.packSize}</p>}
        {line.message && <p className="cart-item-note" data-tone={unavailable ? 'bad' : 'warn'}>{line.message}</p>}
      </div>
      {!unavailable && (
        <>
          <div className="cart-stepper" role="group" aria-label={`Quantity for ${label}`}>
            <button type="button" className="cart-step" aria-label={`Decrease quantity of ${label}`} disabled={busy || line.qty <= 1} onClick={() => onQty(line.variantId, line.qty - 1)}>
              <span aria-hidden="true">−</span>
            </button>
            <output className="cart-qty" aria-live="polite">{line.qty}</output>
            <button type="button" className="cart-step" aria-label={`Increase quantity of ${label}`} disabled={busy || line.qty >= line.maxQty} onClick={() => onQty(line.variantId, line.qty + 1)}>
              <span aria-hidden="true">+</span>
            </button>
          </div>
          <p className="cart-item-price">
            <span className="cart-item-total">{formatRupees(line.lineTotalPaise)}</span>
            {line.qty > 1 && <span className="cart-item-each">{formatRupees(line.unitPaise)} each</span>}
          </p>
        </>
      )}
      <button type="button" className="cart-remove" disabled={busy} onClick={() => onRemove(line.variantId)} aria-label={`Remove ${label} from your bag`}>
        Remove
      </button>
    </li>
  );
}
