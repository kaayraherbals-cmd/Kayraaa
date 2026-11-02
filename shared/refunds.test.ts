import { describe, expect, it } from 'vitest';
import { canRefundTransition, refundableLeft, rupeesToPaise, validateRefundCreate, validateRefundStatus } from './refunds.js';
import { parseRpcError } from './inventory.js';

const O = '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10';
const good = { order_id: O, kind: 'refund_only', reason_code: 'damaged', reason_note: 'Bottle cracked in transit', amount_paise: 34900 };

describe('rupeesToPaise', () => {
  it('reads whole rupees and up to two decimals', () => {
    expect(rupeesToPaise('349')).toBe(34900);
    expect(rupeesToPaise(' 349.5 ')).toBe(34950);
    expect(rupeesToPaise('0.05')).toBe(5);
  });
  it('refuses signs, commas, exponents, three decimals and empty input', () => {
    for (const bad of ['', '-5', '1,000', '1e3', '12.345', 'abc', '12345678']) expect(rupeesToPaise(bad)).toBe(null);
  });
});

describe('validateRefundCreate', () => {
  it('accepts a complete request', () => {
    expect(validateRefundCreate(good)).toEqual({ ok: true, value: good });
  });
  it('rejects a missing order, kind, reason, note or a bad amount, with every problem listed', () => {
    const r = validateRefundCreate({ order_id: 'x', kind: 'x', reason_code: 'x', reason_note: 'a', amount_paise: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(5);
  });
  it('refuses fractional paise, negative, huge and string amounts', () => {
    for (const a of [1.5, -1, 100_000_001, '500']) expect(validateRefundCreate({ ...good, amount_paise: a }).ok).toBe(false);
  });
  it('refuses a non-object', () => {
    expect(validateRefundCreate(null).ok).toBe(false);
    expect(validateRefundCreate([]).ok).toBe(false);
  });
});

describe('refund status ladder', () => {
  it('allows only requested to approved or rejected, and approved to refunded or rejected', () => {
    expect(canRefundTransition('requested', 'approved')).toBe(true);
    expect(canRefundTransition('requested', 'refunded')).toBe(false);
    expect(canRefundTransition('approved', 'refunded')).toBe(true);
    expect(canRefundTransition('approved', 'rejected')).toBe(true);
    expect(canRefundTransition('rejected', 'approved')).toBe(false);
    expect(canRefundTransition('refunded', 'rejected')).toBe(false);
  });
  it('needs a reason to reject and a payout reference to mark refunded', () => {
    expect(validateRefundStatus({ refund_id: O, status: 'rejected' }, 'requested').ok).toBe(false);
    expect(validateRefundStatus({ refund_id: O, status: 'rejected', note: 'Outside the return window' }, 'requested').ok).toBe(true);
    expect(validateRefundStatus({ refund_id: O, status: 'refunded' }, 'approved').ok).toBe(false);
    const r = validateRefundStatus({ refund_id: O, status: 'refunded', payment_ref: 'UTR 4098123', goods_received: true }, 'approved');
    expect(r).toMatchObject({ ok: true, value: { payment_ref: 'UTR 4098123', goods_received: true } });
  });
  it('refuses moving back to requested, skipping a step, or leaving a finished state', () => {
    expect(validateRefundStatus({ refund_id: O, status: 'requested' }).ok).toBe(false);
    expect(validateRefundStatus({ refund_id: O, status: 'refunded', payment_ref: 'UTR 4098123' }, 'requested').ok).toBe(false);
    expect(validateRefundStatus({ refund_id: O, status: 'approved' }, 'refunded').ok).toBe(false);
  });
});

describe('refundableLeft', () => {
  it('counts requested, approved and refunded, but frees a rejected request', () => {
    const rs = [
      { amount_paise: 20000, status: 'requested' as const },
      { amount_paise: 10000, status: 'rejected' as const },
      { amount_paise: 5000, status: 'refunded' as const },
    ];
    expect(refundableLeft(50000, rs)).toBe(25000);
    expect(refundableLeft(10000, rs)).toBe(0);
  });
});

describe('refund database messages', () => {
  it('explains an unpaid order and an over-refund in plain language', () => {
    expect(parseRpcError({ message: 'KH:NOT_PAID' })).toMatchObject({ kind: 'state' });
    expect(parseRpcError({ message: 'KH:REFUND_EXCEEDS:5000' }).message).toContain('₹50 left');
    expect(parseRpcError({ message: 'KH:REFUND_BAD_TRANSITION:rejected>approved' }).message).toContain('rejected to approved');
  });
});
