import { describe, expect, it } from 'vitest';
import type { VariantRecord } from './cart.js';
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, DEFAULT_SETTINGS, METRIC_DEFINITIONS, assessLines, asRedeemResult, formatRate, maskEmail, normaliseStats, preflightOutcome, scheduleDueTimes, settingsFromRow, validateSettingsUpdate, worthSending } from './recovery.js';

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const rec = (id: string, over: Partial<VariantRecord> = {}): VariantRecord => ({ variant_id: id, product_name: 'Tulsi syrup', product_status: 'APPROVED_FOR_SALE', variant_status: 'active', pack_size: '200 ml', price_paise: 49900, gst_rate: 12, hsn_code: '3004', free_qty: 20, ...over });
const map = (...r: VariantRecord[]) => new Map(r.map((x) => [x.variant_id, x]));

describe('defaults', () => {
  it('ship switched off, paused false, 60 minute inactivity, 1h/24h/72h suggestions, three reminders at most', () => {
    expect(DEFAULT_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.inactivityMinutes).toBe(60);
    expect(DEFAULT_SETTINGS.stepDelaysMinutes).toEqual([60, 1440, 4320]);
    expect(DEFAULT_SETTINGS.maxMessagesPerCycle).toBe(3);
  });
  it('settingsFromRow tolerates a missing row and keeps defaults', () => {
    expect(settingsFromRow(null).enabled).toBe(false);
    expect(settingsFromRow({ inactivity_minutes: 90, enabled: true }).inactivityMinutes).toBe(90);
  });
});

describe('settings validation (owner input)', () => {
  it('accepts a valid change and reports only what changed', () => {
    const r = validateSettingsUpdate({ enabled: true, inactivityMinutes: 120, stepDelaysMinutes: [120, 1500, 5000] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch).toEqual({ enabled: true, inactivity_minutes: 120, step_delays_minutes: [120, 1500, 5000] });
  });
  it('rejects unknown fields instead of ignoring them', () => {
    const r = validateSettingsUpdate({ enabled: true, sendNow: true });
    expect(r.ok).toBe(false);
  });
  it('rejects out of range numbers, non-integers and strings', () => {
    for (const bad of [{ inactivityMinutes: 5 }, { inactivityMinutes: 1.5 }, { inactivityMinutes: '60' }, { maxMessagesPerCycle: 4 }, { batchSize: 0 }, { batchSize: 101 }, { tokenTtlHours: 1000 }, { enabled: 'yes' }])
      expect(validateSettingsUpdate(bad).ok).toBe(false);
  });
  it('rejects delays that are not strictly increasing or not three', () => {
    expect(validateSettingsUpdate({ stepDelaysMinutes: [60, 60, 100] }).ok).toBe(false);
    expect(validateSettingsUpdate({ stepDelaysMinutes: [100, 50, 200] }).ok).toBe(false);
    expect(validateSettingsUpdate({ stepDelaysMinutes: [60, 1440] }).ok).toBe(false);
  });
  it('rejects empty and non-object bodies', () => {
    expect(validateSettingsUpdate({}).ok).toBe(false);
    expect(validateSettingsUpdate(null).ok).toBe(false);
    expect(validateSettingsUpdate([]).ok).toBe(false);
  });
});

describe('reminder scheduling', () => {
  it('abandonment is last activity + inactivity, reminders come the configured minutes after that', () => {
    const t0 = Date.UTC(2026, 9, 22, 10, 0, 0);
    const due = scheduleDueTimes(t0, DEFAULT_SETTINGS);
    expect(due).toEqual([t0 + 120 * 60_000, t0 + (60 + 1440) * 60_000, t0 + (60 + 4320) * 60_000]);
  });
  it('honours a lower per-bag limit and a changed inactivity time', () => {
    const t0 = 1_000_000;
    expect(scheduleDueTimes(t0, { ...DEFAULT_SETTINGS, maxMessagesPerCycle: 2 })).toHaveLength(2);
    expect(scheduleDueTimes(t0, { ...DEFAULT_SETTINGS, inactivityMinutes: 30 })[0]).toBe(t0 + 90 * 60_000);
  });
});

describe('pre-send outcomes', () => {
  it('waits (does not end the reminder) for paused, disabled, active checkout and the minimum gap', () => {
    for (const reason of ['paused', 'disabled', 'checkout_active', 'min_gap']) expect(preflightOutcome({ ok: false, defer: true, reason })).toEqual({ status: 'scheduled', reason });
  });
  it('ends the reminder for purchase, no consent, suppression, closed, duplicate and limits', () => {
    for (const reason of ['purchased', 'no_consent', 'suppressed', 'cycle_closed', 'duplicate', 'member_limit', 'cycle_limit', 'cart_changed', 'cart_empty']) expect(preflightOutcome({ ok: false, reason })).toEqual({ status: 'skipped', reason });
  });
  it('returns null when everything passed', () => {
    expect(preflightOutcome({ ok: true })).toBeNull();
  });
});

describe('price and stock re-check', () => {
  it('uses TODAY\'s price, not any earlier one', () => {
    const a = assessLines([{ variantId: V1, qty: 2 }], map(rec(V1, { price_paise: 52900 })));
    expect(a.lines[0]!.unitPaise).toBe(52900);
    expect(a.subtotalPaise).toBe(105800);
  });
  it('leaves out unpublished products, inactive packs, unpriced and out-of-stock items, and names them', () => {
    const a = assessLines(
      [{ variantId: V1, qty: 1 }, { variantId: V2, qty: 1 }, { variantId: '33333333-3333-4333-8333-333333333333', qty: 1 }, { variantId: '44444444-4444-4444-8444-444444444444', qty: 1 }, { variantId: '55555555-5555-4555-8555-555555555555', qty: 1 }],
      map(rec(V1), rec(V2, { product_status: 'DRAFT' }), rec('33333333-3333-4333-8333-333333333333', { variant_status: 'inactive' }), rec('44444444-4444-4444-8444-444444444444', { price_paise: null }), rec('55555555-5555-4555-8555-555555555555', { free_qty: 0 })),
    );
    expect(a.lines).toHaveLength(1);
    expect(a.unavailable).toHaveLength(4);
  });
  it('lowers the quantity to the stock on hand and flags it', () => {
    const a = assessLines([{ variantId: V1, qty: 8 }], map(rec(V1, { free_qty: 3 })));
    expect(a.lines[0]!.qty).toBe(3);
    expect(a.lines[0]!.reduced).toBe(true);
  });
  it('is not worth sending when nothing can be bought, and when the product is gone', () => {
    expect(worthSending(assessLines([{ variantId: V1, qty: 1 }], map(rec(V1, { free_qty: 0 }))))).toBe(false);
    expect(worthSending(assessLines([{ variantId: V1, qty: 1 }], new Map()))).toBe(false);
    expect(worthSending(assessLines([{ variantId: V1, qty: 1 }], map(rec(V1))))).toBe(true);
  });
});

describe('dashboard helpers', () => {
  it('masks emails', () => {
    expect(maskEmail('asha.verma@gmail.com')).toBe('a***@g***.com');
    expect(maskEmail(null)).toBe('***');
    expect(maskEmail('nonsense')).toBe('***');
  });
  it('normalises stats so a bad row cannot show NaN, and rates are n/a without data', () => {
    const s = normaliseStats({ emails_sent: 'x', recovered_orders: 2, conversion_rate: null, top_products: [{ product: 'A', pack_size: '1', carts: 3 }] });
    expect(s.emails_sent).toBe(0);
    expect(s.recovered_orders).toBe(2);
    expect(formatRate(s.conversion_rate)).toBe('n/a');
    expect(formatRate(0.1234)).toBe('12.3%');
    expect(s.top_products).toHaveLength(1);
  });
  it('defines revenue as attributed, not incremental', () => {
    expect(METRIC_DEFINITIONS.attributed_revenue).toMatch(/not proven extra/i);
  });
  it('unknown redeem results collapse to invalid', () => {
    expect(asRedeemResult('ok')).toBe('ok');
    expect(asRedeemResult('whatever')).toBe('invalid');
  });
  it('consent wording is versioned, optional and mentions switching off', () => {
    expect(CONSENT_TEXT_VERSION).toMatch(/^cart-reminders-v\d+$/);
    expect(CONSENT_TEXT).toMatch(/switch this off/i);
    expect(CONSENT_TEXT).toMatch(/at most three/i);
  });
});
