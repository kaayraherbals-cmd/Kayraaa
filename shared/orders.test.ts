import { describe, expect, it } from 'vitest';
import { ORDER_CSV_HEADERS, ORDER_STATUSES, canTransition, formatInr, nextStatuses, orderCsvRow, orderTotal, validateNewOrder, validateOrderNote, validateStatusChange, type Order } from './orders.js';
import { toCsv } from './admin.js';

const V1 = '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10';
const V2 = '2d8e4d20-7e9b-4dbc-8f30-5b4c1e3f9a32';
const O = '3e9f5e31-8fac-4ecd-9041-6c5d2f4a0b43';
const good = { customer_name: 'Asha Verma', customer_email: 'Asha@Example.com', customer_phone: '+91 98765-43210', ship_address: '12 Lanka Road, Varanasi', ship_pincode: '221005', shipping_paise: 6000, note: 'Gift', items: [{ variant_id: V1, qty: 2 }, { variant_id: V2, qty: 1 }] };

describe('order status ladder', () => {
  it('moves forward one step and can be cancelled only before shipping', () => {
    expect(nextStatuses('placed')).toEqual(['paid', 'cancelled']);
    expect(canTransition('paid', 'packed')).toBe(true);
    expect(canTransition('packed', 'shipped')).toBe(true);
    expect(canTransition('shipped', 'delivered')).toBe(true);
    for (const to of ORDER_STATUSES) {
      expect(canTransition('delivered', to)).toBe(false);
      expect(canTransition('cancelled', to)).toBe(false);
    }
    expect(canTransition('shipped', 'cancelled')).toBe(false);
    expect(canTransition('placed', 'shipped')).toBe(false);
    expect(canTransition('paid', 'placed')).toBe(false);
  });
});

describe('new order validation', () => {
  it('accepts a complete order and normalises contact details', () => {
    const r = validateNewOrder(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.customer_email).toBe('asha@example.com');
      expect(r.value.customer_phone).toBe('+919876543210');
      expect(r.value.items).toHaveLength(2);
    }
  });
  it('never reads a price from the client', () => {
    const r = validateNewOrder({ ...good, items: [{ variant_id: V1, qty: 1, unit_price_paise: 1 }], unit_price_paise: 1, total_paise: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.value)).not.toContain('unit_price');
  });
  it('rejects bad items, quantities and duplicates', () => {
    expect(validateNewOrder({ ...good, items: [] }).ok).toBe(false);
    expect(validateNewOrder({ ...good, items: [{ variant_id: 'x', qty: 1 }] }).ok).toBe(false);
    expect(validateNewOrder({ ...good, items: [{ variant_id: V1, qty: 0 }] }).ok).toBe(false);
    expect(validateNewOrder({ ...good, items: [{ variant_id: V1, qty: 101 }] }).ok).toBe(false);
    expect(validateNewOrder({ ...good, items: [{ variant_id: V1, qty: 1.5 }] }).ok).toBe(false);
    expect(validateNewOrder({ ...good, items: [{ variant_id: V1, qty: 1 }, { variant_id: V1, qty: 2 }] }).ok).toBe(false);
    expect(validateNewOrder({ ...good, items: Array.from({ length: 21 }, (_, i) => ({ variant_id: `${i.toString(16).padStart(8, '0')}-5c79-4b9a-8d1e-3f2a9c1d7e10`, qty: 1 })) }).ok).toBe(false);
  });
  it('rejects bad contact and address details', () => {
    expect(validateNewOrder({ ...good, customer_name: ' ' }).ok).toBe(false);
    expect(validateNewOrder({ ...good, customer_email: 'nope' }).ok).toBe(false);
    expect(validateNewOrder({ ...good, customer_phone: '12' }).ok).toBe(false);
    expect(validateNewOrder({ ...good, ship_pincode: '012345' }).ok).toBe(false);
    expect(validateNewOrder({ ...good, ship_pincode: '22100' }).ok).toBe(false);
    expect(validateNewOrder({ ...good, ship_address: 'short' }).ok).toBe(false);
    expect(validateNewOrder({ ...good, shipping_paise: -1 }).ok).toBe(false);
    expect(validateNewOrder({ ...good, shipping_paise: 2_000_000 }).ok).toBe(false);
    expect(validateNewOrder({ ...good, customer_email: '', customer_phone: '', note: '' }).ok).toBe(true);
  });
});

describe('status changes', () => {
  it('needs a courier and tracking number to ship, and a reason to cancel', () => {
    expect(validateStatusChange({ order_id: O, status: 'shipped' }, 'packed').ok).toBe(false);
    expect(validateStatusChange({ order_id: O, status: 'shipped', courier: 'DTDC', tracking_no: 'D1234567' }, 'packed').ok).toBe(true);
    expect(validateStatusChange({ order_id: O, status: 'shipped', courier: 'DTDC', tracking_no: "x'; --" }, 'packed').ok).toBe(false);
    expect(validateStatusChange({ order_id: O, status: 'cancelled' }, 'paid').ok).toBe(false);
    expect(validateStatusChange({ order_id: O, status: 'cancelled', reason: 'Customer asked' }, 'paid').ok).toBe(true);
  });
  it('refuses moves the ladder does not allow when the current status is known', () => {
    expect(validateStatusChange({ order_id: O, status: 'delivered' }, 'placed').ok).toBe(false);
    expect(validateStatusChange({ order_id: O, status: 'paid' }, 'placed').ok).toBe(true);
    expect(validateStatusChange({ order_id: O, status: 'refunded' }).ok).toBe(false);
  });
  it('validates notes', () => {
    expect(validateOrderNote({ order_id: O, note: 'Called the customer' }).ok).toBe(true);
    expect(validateOrderNote({ order_id: O, note: 'x' }).ok).toBe(false);
    expect(validateOrderNote({ order_id: 'bad', note: 'Called the customer' }).ok).toBe(false);
  });
});

describe('money', () => {
  it('totals lines and shipping in paise', () => {
    expect(orderTotal([{ unit_price_paise: 34900, qty: 2 }, { unit_price_paise: 19950, qty: 1 }], 6000)).toEqual({ subtotal: 89750, total: 95750 });
  });
  it('formats rupees the Indian way', () => {
    expect(formatInr(34900)).toBe('₹349');
    expect(formatInr(34950)).toBe('₹349.50');
    expect(formatInr(12345600)).toBe('₹1,23,456');
  });
  it('exports CSV with formula injection neutralised', () => {
    const o = { order_no: 'KH-2026-000001', created_at: '2026-10-17', status: 'placed', customer_name: '=cmd|calc', customer_email: null, customer_phone: null, ship_pincode: '221005', subtotal_paise: 100, shipping_paise: 50, total_paise: 150, courier: null, tracking_no: null } as unknown as Order;
    const csv = toCsv([...ORDER_CSV_HEADERS], [orderCsvRow(o)]);
    expect(csv).toContain(`"'=cmd|calc"`);
    expect(csv).toContain('"1.00","0.50","1.50"');
  });
});
