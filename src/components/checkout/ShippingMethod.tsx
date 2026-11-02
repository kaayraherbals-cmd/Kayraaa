import { formatRupees } from '../../../shared/cart';

/** One delivery method, priced by the server for the PIN code. Courier choice arrives with the shipping layer (Section 6). */
export default function ShippingMethod({ label, paise }: { label: string; paise: number }) {
  return (
    <div className="co-ship" role="group" aria-label="Delivery method">
      <span>
        <strong>{label}</strong>
        <small>Delivery time is confirmed when the order ships.</small>
      </span>
      <span>{paise === 0 ? 'Free' : formatRupees(paise)}</span>
    </div>
  );
}
