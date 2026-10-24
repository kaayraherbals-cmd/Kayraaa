import { describe, expect, it } from 'vitest';
import { gatewayRefundableLeft, isCollectable, isHandledEvent, parseWebhook } from './payments.js';

const captured = {
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_ABC123456', order_id: 'order_XYZ123456', amount: 50000, method: 'upi', status: 'captured' } } },
};

describe('parseWebhook', () => {
  it('picks out only the fields we use', () => {
    expect(parseWebhook(captured)).toMatchObject({ event: 'payment.captured', rp_order_id: 'order_XYZ123456', rp_payment_id: 'pay_ABC123456', amount_paise: 50000, method: 'upi' });
  });
  it('reads a failed payment reason', () => {
    const p = parseWebhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_F00000001', order_id: 'order_F00000001', amount: 100, error_code: 'BAD_REQUEST_ERROR', error_description: 'Payment failed' } } } });
    expect(p).toMatchObject({ error_code: 'BAD_REQUEST_ERROR', error_note: 'Payment failed' });
  });
  it('reads a refund event by refund id', () => {
    const p = parseWebhook({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_R0000001', payment_id: 'pay_ABC123456' } } } });
    expect(p).toMatchObject({ rp_refund_id: 'rfnd_R0000001', rp_payment_id: 'pay_ABC123456', rp_order_id: null });
  });
  it('never trusts a non-integer, zero, negative or string amount', () => {
    for (const amount of [50000.5, 0, -1, '50000', Number.NaN, 1e20]) {
      const p = parseWebhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_A00000001', order_id: 'order_A00000001', amount } } } });
      expect(p?.amount_paise).toBeNull();
    }
  });
  it('rejects anything that is not shaped like an event', () => {
    for (const b of [null, [], 'x', {}, { event: 1 }, { event: 'payment.captured' }, { event: 'payment.captured', payload: 'no' }]) expect(parseWebhook(b)).toBeNull();
  });
});

describe('helpers', () => {
  it('knows which events it acts on', () => {
    expect(isHandledEvent('payment.captured')).toBe(true);
    expect(isHandledEvent('payment.created')).toBe(false);
    expect(isHandledEvent(undefined)).toBe(false);
  });
  it('collects only whole positive paise within the ceiling', () => {
    expect(isCollectable(50000)).toBe(true);
    for (const v of [0, -5, 10.5, '100', 50_000_001, Number.NaN]) expect(isCollectable(v)).toBe(false);
  });
  it('never reports a negative refundable amount', () => {
    expect(gatewayRefundableLeft(50000, 20000)).toBe(30000);
    expect(gatewayRefundableLeft(50000, 70000)).toBe(0);
  });
});

// ---- Section 4: customer payment rules ----
import { clientPayState, decideVerification, keyMatchesOrder, keyMode, paymentsOpen, syntheticEventId, validateOrderRef, validateVerifyRequest } from './payments.js';
import { readFlags } from './flags.js';

const flagsOn = (extra: Record<string, string> = {}) => readFlags({ FEATURE_CART_PREVIEW: 'on', FEATURE_CHECKOUT_TESTING: 'on', FEATURE_PAYMENT_TEST_MODE: 'on', ...extra });
const TEST_KEY = 'rzp_test_ABCDEF123456';

describe('paymentsOpen', () => {
  it('opens with a TEST key outside production', () => {
    expect(paymentsOpen(flagsOn(), TEST_KEY)).toBe(true);
  });
  it('never accepts a LIVE key outside approved production', () => {
    expect(paymentsOpen(flagsOn(), 'rzp_live_ABCDEF123456')).toBe(false);
  });
  it('never accepts a missing key or a malformed key', () => {
    for (const k of [null, '', 'rzp_ABCDEF', 'RZP_TEST_ABC']) expect(paymentsOpen(flagsOn(), k)).toBe(false);
  });
  it('stays closed in production, even with a valid key', () => {
    expect(paymentsOpen(readFlags({ VERCEL_ENV: 'production' }), 'rzp_live_ABCDEF123456')).toBe(false);
    expect(paymentsOpen(readFlags({ VERCEL_ENV: 'production', FEATURE_CART_PREVIEW: 'on', FEATURE_CHECKOUT_TESTING: 'on', FEATURE_PAYMENT_TEST_MODE: 'on' }), TEST_KEY)).toBe(false);
  });
  it('reads the key mode from its prefix only', () => {
    expect(keyMode('rzp_test_x')).toBe('test');
    expect(keyMode('rzp_live_x')).toBe('live');
    expect(keyMode('test_rzp_x')).toBeNull();
  });
});

describe('request validation', () => {
  const O = '123e4567-e89b-42d3-a456-426614174001';
  const good = { orderId: O, razorpay_order_id: 'order_ABC12345', razorpay_payment_id: 'pay_ABC12345', razorpay_signature: 'a'.repeat(64) };
  it('accepts exactly the shapes Razorpay and our database produce', () => {
    expect(validateOrderRef({ orderId: O })).toEqual({ ok: true, orderId: O });
    const v = validateVerifyRequest(good);
    expect(v.ok).toBe(true);
  });
  it('rejects anything else, including path tricks and wrong-length signatures', () => {
    for (const bad of [null, [], 'x', {}, { ...good, orderId: 'x' }, { ...good, razorpay_order_id: 'order_a/../x' }, { ...good, razorpay_payment_id: 'pay_' }, { ...good, razorpay_signature: 'a'.repeat(63) }, { ...good, razorpay_signature: 'g'.repeat(64) }, { ...good, razorpay_payment_id: 5 }]) {
      expect(validateVerifyRequest(bad).ok).toBe(false);
    }
    expect(validateOrderRef({ orderId: `${O} ` }).ok).toBe(false);
  });
  it('ignores extra fields such as an amount from the browser', () => {
    const v = validateVerifyRequest({ ...good, amount: 1, amountPaise: 1 });
    expect(v.ok && Object.keys(v.value).sort()).toEqual(['orderId', 'rpOrderId', 'rpPaymentId', 'signature']);
  });
});

describe('decideVerification', () => {
  const expect_ = { rpOrderId: 'order_ABC12345', rpPaymentId: 'pay_ABC12345', amountPaise: 50000 };
  const p = (over = {}) => ({ id: 'pay_ABC12345', order_id: 'order_ABC12345', amount: 50000, currency: 'INR', status: 'captured', ...over });
  it('believes a capture only when payment id, order id, amount and currency all match', () => {
    expect(decideVerification(p(), expect_)).toEqual({ kind: 'captured', event: 'payment.captured' });
  });
  it('refuses on any single difference', () => {
    expect(decideVerification(p({ amount: 49999 }), expect_)).toEqual({ kind: 'mismatch', reason: 'amount' });
    expect(decideVerification(p({ amount: 50001 }), expect_)).toEqual({ kind: 'mismatch', reason: 'amount' });
    expect(decideVerification(p({ currency: 'USD' }), expect_)).toEqual({ kind: 'mismatch', reason: 'currency' });
    expect(decideVerification(p({ order_id: 'order_OTHER0001' }), expect_)).toEqual({ kind: 'mismatch', reason: 'order' });
    expect(decideVerification(p({ order_id: null }), expect_)).toEqual({ kind: 'mismatch', reason: 'order' });
    expect(decideVerification(p({ id: 'pay_SOMEONE001' }), expect_)).toEqual({ kind: 'mismatch', reason: 'order' });
  });
  it('treats created, authorized and unknown statuses as still processing, failed as failed', () => {
    for (const s of ['created', 'authorized', 'refunded', 'weird']) expect(decideVerification(p({ status: s }), expect_)).toEqual({ kind: 'processing' });
    expect(decideVerification(p({ status: 'failed' }), expect_)).toEqual({ kind: 'failed', event: 'payment.failed' });
  });
});

describe('clientPayState', () => {
  const none = { status: null, flagged: null } as const;
  it('shows paid only for a captured payment or an order that has moved past placed', () => {
    expect(clientPayState({ status: 'placed' }, { status: 'captured', flagged: null })).toBe('paid');
    expect(clientPayState({ status: 'paid' }, none)).toBe('paid');
    expect(clientPayState({ status: 'placed' }, none)).toBe('unpaid');
    expect(clientPayState({ status: 'placed' }, { status: 'created', flagged: null })).toBe('unpaid');
    expect(clientPayState({ status: 'placed' }, { status: 'authorized', flagged: null })).toBe('processing');
    expect(clientPayState({ status: 'placed' }, { status: 'failed', flagged: null })).toBe('failed');
    expect(clientPayState({ status: 'cancelled' }, none)).toBe('cancelled');
  });
  it('a flag always wins: money and order disagree, so it is never "paid"', () => {
    expect(clientPayState({ status: 'placed' }, { status: 'created', flagged: 'amount_mismatch' })).toBe('review');
    expect(clientPayState({ status: 'cancelled' }, { status: 'captured', flagged: 'order_not_open' })).toBe('review');
  });
  it('builds a stable synthetic event id', () => {
    expect(syntheticEventId('verify', 'pay_1', 'payment.captured')).toBe('verify:pay_1:payment.captured');
  });
});

describe('test and live credentials never mix', () => {
  it('pairs a test order only with a test key and a live order only with a live key', () => {
    expect(keyMatchesOrder(true, 'rzp_test_ABCDEF123456')).toBe(true);
    expect(keyMatchesOrder(true, 'rzp_live_ABCDEF123456')).toBe(false);
    expect(keyMatchesOrder(false, 'rzp_live_ABCDEF123456')).toBe(true);
    expect(keyMatchesOrder(false, 'rzp_test_ABCDEF123456')).toBe(false);
    expect(keyMatchesOrder(false, 'junk')).toBe(false);
  });
});
