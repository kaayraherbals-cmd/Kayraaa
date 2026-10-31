import { describe, expect, it } from 'vitest';
import { daysBetween, expiryState, isIsoDate, parseRpcError, sellableUnits, summariseStock, todayIST, validateAdjust, validateBatchStatus, validateReceive } from './inventory.js';

const V = '0b6c2b0e-5c79-4b9a-8d1e-3f2a9c1d7e10';
const B = '1c7d3c1f-6d8a-4cab-9e2f-4a3b0d2e8f21';
const TODAY = '2026-10-17';

describe('dates', () => {
  it('validates calendar dates strictly', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate(20260301)).toBe(false);
    expect(daysBetween('2026-10-17', '2026-11-16')).toBe(30);
    expect(daysBetween('2026-10-17', '2026-10-10')).toBe(-7);
  });
  it('uses the Indian calendar day (IST is 5h30 ahead of UTC)', () => {
    expect(todayIST(Date.parse('2026-10-17T20:00:00Z'))).toBe('2026-10-18');
    expect(todayIST(Date.parse('2026-10-17T18:29:00Z'))).toBe('2026-10-17');
  });
});

describe('stock summary', () => {
  const b = (expiry: string, onHand: number, reserved = 0, status: 'active' | 'quarantine' | 'recalled' | 'closed' = 'active') => ({ status, expiry_date: expiry, qty_on_hand: onHand, qty_reserved: reserved });
  it('never counts expired, short-dated, quarantined or recalled stock as sellable', () => {
    expect(sellableUnits(b('2026-10-16', 50), TODAY)).toBe(0); // expired yesterday
    expect(sellableUnits(b('2026-11-10', 50), TODAY)).toBe(0); // 24 days left, under the 30-day floor
    expect(sellableUnits(b('2026-11-16', 50), TODAY)).toBe(50); // exactly 30 days
    expect(sellableUnits(b('2027-06-01', 50, 20), TODAY)).toBe(30);
    expect(sellableUnits(b('2027-06-01', 50, 0, 'quarantine'), TODAY)).toBe(0);
    expect(sellableUnits(b('2027-06-01', 50, 0, 'recalled'), TODAY)).toBe(0);
  });
  it('classifies expiry', () => {
    expect(expiryState('2026-10-16', TODAY)).toBe('expired');
    expect(expiryState('2026-10-17', TODAY)).toBe('expiring');
    expect(expiryState('2027-01-15', TODAY)).toBe('expiring'); // 90 days
    expect(expiryState('2027-01-16', TODAY)).toBe('ok');
  });
  it('summarises a product across batches', () => {
    const s = summariseStock([b('2026-10-01', 7), b('2026-12-20', 40, 10), b('2027-09-01', 100, 5), b('2027-09-01', 0)], 20, TODAY);
    expect(s).toEqual({ onHand: 147, reserved: 15, available: 30 + 95 + 0, expiredUnits: 7, expiringUnits: 40, nextExpiry: '2026-10-01', low: false, out: false });
  });
  it('flags low and out of stock', () => {
    expect(summariseStock([b('2027-09-01', 15)], 20, TODAY)).toMatchObject({ low: true, out: false, available: 15 });
    expect(summariseStock([b('2027-09-01', 0)], 20, TODAY)).toMatchObject({ low: false, out: true, available: 0 });
    expect(summariseStock([b('2026-09-01', 30)], 20, TODAY)).toMatchObject({ out: true, expiredUnits: 30 });
    expect(summariseStock([], 20, TODAY).nextExpiry).toBeNull();
  });
});

describe('receiving stock', () => {
  const ok = { variant_id: V, batch_no: ' kh/2610-a ', mfg_date: '2026-10-01', expiry_date: '2028-09-30', qty: 240, note: 'First lot' };
  it('accepts a good batch and normalises the batch number', () => {
    const r = validateReceive(ok, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ variant_id: V, batch_no: 'KH/2610-A', mfg_date: '2026-10-01', expiry_date: '2028-09-30', qty: 240, note: 'First lot' });
  });
  it('refuses expired, missing or inconsistent dates', () => {
    expect(validateReceive({ ...ok, expiry_date: '2026-10-17' }, TODAY).ok).toBe(false);
    expect(validateReceive({ ...ok, expiry_date: '2026-10-01' }, TODAY).ok).toBe(false);
    expect(validateReceive({ ...ok, expiry_date: '' }, TODAY).ok).toBe(false);
    expect(validateReceive({ ...ok, mfg_date: '2026-10-25' }, TODAY).ok).toBe(false); // in the future
    expect(validateReceive({ ...ok, mfg_date: '2029-01-01', expiry_date: '2028-09-30' }, TODAY).ok).toBe(false);
    expect(validateReceive({ ...ok, mfg_date: null }, TODAY).ok).toBe(true);
  });
  it('refuses bad quantities, batch numbers and variants', () => {
    for (const qty of [0, -5, 1.5, '10', 1_000_001, null]) expect(validateReceive({ ...ok, qty }, TODAY).ok).toBe(false);
    for (const batch_no of ['', ' ', '-x', 'a b', 'x'.repeat(41), "a'; drop"]) expect(validateReceive({ ...ok, batch_no }, TODAY).ok).toBe(false);
    expect(validateReceive({ ...ok, variant_id: 'nope' }, TODAY).ok).toBe(false);
    expect(validateReceive(null, TODAY).ok).toBe(false);
  });
});

describe('adjustments', () => {
  it('needs a reason, a non-zero whole number and a batch', () => {
    expect(validateAdjust({ batch_id: B, kind: 'adjust', delta: 5, reason: 'Recount found extra' }).ok).toBe(true);
    expect(validateAdjust({ batch_id: B, kind: 'adjust', delta: -5, reason: 'Damaged' }).ok).toBe(true);
    expect(validateAdjust({ batch_id: B, kind: 'adjust', delta: 0, reason: 'Damaged' }).ok).toBe(false);
    expect(validateAdjust({ batch_id: B, kind: 'adjust', delta: 2.5, reason: 'Damaged' }).ok).toBe(false);
    expect(validateAdjust({ batch_id: B, kind: 'adjust', delta: 5, reason: '' }).ok).toBe(false);
    expect(validateAdjust({ batch_id: B, kind: 'adjust', delta: 5, reason: 'x' }).ok).toBe(false);
    expect(validateAdjust({ batch_id: 'x', kind: 'adjust', delta: 5, reason: 'Recount' }).ok).toBe(false);
  });
  it('only lets a write-off remove stock', () => {
    expect(validateAdjust({ batch_id: B, kind: 'write_off', delta: -12, reason: 'Expired' }).ok).toBe(true);
    expect(validateAdjust({ batch_id: B, kind: 'write_off', delta: 12, reason: 'Expired' }).ok).toBe(false);
    expect(validateAdjust({ batch_id: B, kind: 'other', delta: -1, reason: 'Expired' }).ok).toBe(false);
  });
  it('validates batch status changes', () => {
    expect(validateBatchStatus({ batch_id: B, status: 'quarantine' }).ok).toBe(true);
    expect(validateBatchStatus({ batch_id: B, status: 'lost' }).ok).toBe(false);
    expect(validateBatchStatus({ batch_id: 'x', status: 'active' }).ok).toBe(false);
  });
});

describe('database error mapping', () => {
  it('turns KH: messages into plain language and hides everything else', () => {
    expect(parseRpcError({ message: 'KH:INSUFFICIENT_STOCK:Iron Syrup 150 ml|4' })).toEqual({ kind: 'insufficient_stock', message: 'Not enough in-date stock for Iron Syrup 150 ml (only 4 available).' });
    expect(parseRpcError({ message: 'KH:BAD_TRANSITION:shipped>placed' }).message).toBe('An order cannot move from shipped to placed.');
    expect(parseRpcError({ message: 'KH:NEGATIVE_STOCK' }).kind).toBe('state');
    expect(parseRpcError({ message: 'KH:RESERVED_STOCK' }).message).toContain('reserved for open orders');
    expect(parseRpcError({ message: 'KH:NO_PRICE:Iron Syrup 150 ml' }).message).toBe('Iron Syrup 150 ml has no price set.');
    expect(parseRpcError({ message: 'KH:EXPIRED_ALLOCATION:KH-26-A' }).message).toContain('Batch KH-26-A has expired');
    expect(parseRpcError({ message: 'KH:NOT_FOR_SALE:Piles Syrup' }).message).toContain('not approved for sale');
    const unknown = parseRpcError({ message: 'duplicate key value violates unique constraint "secret_table_pkey"' });
    expect(unknown.kind).toBe('unknown');
    expect(unknown.message).not.toContain('secret_table');
    expect(parseRpcError(null).kind).toBe('unknown');
  });
});

describe('parseRpcError: rewards and bundle codes (Stage 7C)', () => {
  it('maps the new codes to plain messages', () => {
    for (const c of ['DISABLED', 'LOYALTY_POLICY_PENDING', 'NOT_ENROLLED', 'STACKING', 'LIMIT', 'INSUFFICIENT', 'BUNDLE_COUPON_EXCLUDED']) {
      const f = parseRpcError({ message: `KH:${c}` });
      expect(f.kind).toBe('state');
    }
    expect(parseRpcError({ message: 'KH:BUNDLE_UNAVAILABLE:Kit' }).message).toContain('Kit');
  });
});
