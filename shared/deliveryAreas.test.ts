import { describe, expect, it } from 'vitest';
import { cleanLabel, isFreeAbovePaise, isRatePaise, parseBulk, rupeesToPaiseOrZero, validateAreaCreate, validateAreaUpdate, validateBulk } from './deliveryAreas.js';

describe('money', () => {
  it('allows a zero charge, unlike a price', () => {
    expect(rupeesToPaiseOrZero('0')).toEqual({ ok: true, value: 0 });
    expect(rupeesToPaiseOrZero('1,499.50')).toEqual({ ok: true, value: 149950 });
    expect(rupeesToPaiseOrZero('')).toEqual({ ok: true, value: null });
    for (const bad of ['-5', '1.234', 'abc', '99999999']) expect(rupeesToPaiseOrZero(bad).ok).toBe(false);
  });
  it('matches the database limits', () => {
    expect(isRatePaise(0) && isRatePaise(1_000_000)).toBe(true);
    expect([-1, 1_000_001, 1.5, '60', null].some((v) => isRatePaise(v))).toBe(false);
    expect(isFreeAbovePaise(null) && isFreeAbovePaise(1)).toBe(true);
    expect([0, -5, 2.5, '100'].some((v) => isFreeAbovePaise(v))).toBe(false);
  });
});

describe('labels', () => {
  it('trims, collapses spaces and turns empty into null', () => {
    expect(cleanLabel('  New   Delhi ')).toEqual({ ok: true, value: 'New Delhi' });
    expect(cleanLabel('  ')).toEqual({ ok: true, value: null });
    expect(cleanLabel("Cuttack (Odisha), St. John's")).toEqual({ ok: true, value: "Cuttack (Odisha), St. John's" });
  });
  it('refuses markup, quotes, control characters and long text', () => {
    for (const bad of ['<b>', 'a"b', 'a\u0000b', 'x'.repeat(61), 5]) expect(cleanLabel(bad).ok).toBe(false);
  });
});

describe('add and update', () => {
  const good = { pincode: '221005', ratePaise: 6000, freeAbovePaise: 150000, city: 'Varanasi', state: 'Uttar Pradesh' };
  it('accepts a complete area and defaults to on', () => {
    expect(validateAreaCreate(good)).toEqual({ ok: true, value: { pincode: '221005', active: true, ratePaise: 6000, freeAbovePaise: 150000, city: 'Varanasi', state: 'Uttar Pradesh' } });
  });
  it('rejects bad PINs, charges and amounts with plain messages', () => {
    expect(validateAreaCreate({ ...good, pincode: '22100' }).ok).toBe(false);
    expect(validateAreaCreate({ ...good, pincode: '100001' }).ok).toBe(false);
    expect(validateAreaCreate({ ...good, ratePaise: -1 }).ok).toBe(false);
    expect(validateAreaCreate({ ...good, freeAbovePaise: 0 }).ok).toBe(false);
    expect(validateAreaCreate(null).ok).toBe(false);
  });
  it('updates only what is sent and refuses unknown fields', () => {
    expect(validateAreaUpdate({ active: false })).toEqual({ ok: true, value: { active: false } });
    expect(validateAreaUpdate({ freeAbovePaise: null, city: '' })).toEqual({ ok: true, value: { free_above_paise: null, city: null } });
    expect(validateAreaUpdate({ pincode: '221006' }).ok).toBe(false);
    expect(validateAreaUpdate({}).ok).toBe(false);
    expect(validateAreaUpdate({ active: 'yes' }).ok).toBe(false);
  });
});

describe('bulk paste', () => {
  it('reads PINs one per line, several per line, and PIN, city, state', () => {
    const r = parseBulk('221005\n221006, Varanasi, Uttar Pradesh\r\n110001 110002;110003\n\n');
    expect(r.problems).toEqual([]);
    expect(r.entries.map((e) => e.pincode)).toEqual(['221005', '221006', '110001', '110002', '110003']);
    expect(r.entries[1]).toEqual({ pincode: '221006', city: 'Varanasi', state: 'Uttar Pradesh' });
  });
  it('keeps the first of a repeated PIN and counts the rest', () => {
    const r = parseBulk('221005, Varanasi\n221005, Other\n221005');
    expect(r.entries).toEqual([{ pincode: '221005', city: 'Varanasi', state: null }]);
    expect(r.duplicates).toBe(2);
  });
  it('reports each bad line by number instead of guessing', () => {
    const r = parseBulk('221005\nabc\n100001\n221006, A, B, C\n22100');
    expect(r.problems.map((p) => p.line)).toEqual([2, 3, 4, 5]);
    expect(r.entries.map((e) => e.pincode)).toEqual(['221005']);
  });
  it('refuses more than 2000 at once', () => {
    const many = Array.from({ length: 2001 }, (_, i) => String(200000 + i)).join('\n');
    expect(parseBulk(many).problems[0].reason).toMatch(/at most 2000/);
  });
  it('validateBulk needs the settings and applies nothing when any line is bad', () => {
    const ok = { text: '221005\n221006', ratePaise: 6000, freeAbovePaise: null, active: true, city: 'Varanasi', state: '', onExisting: 'update' };
    const v = validateBulk(ok);
    expect(v.ok && v.value.req.city).toBe('Varanasi');
    expect(validateBulk({ ...ok, text: '221005\nnope' }).ok).toBe(false);
    expect(validateBulk({ ...ok, onExisting: 'delete' }).ok).toBe(false);
    expect(validateBulk({ ...ok, active: undefined }).ok).toBe(false);
    expect(validateBulk({ ...ok, text: '' }).ok).toBe(false);
  });
});

describe('csv row', () => {
  it('writes rupees with two decimals and blank for never free', async () => {
    const { deliveryCsvRow } = await import('./deliveryAreas.js');
    expect(deliveryCsvRow({ pincode: '221005', active: false, rate_paise: 0, free_above_paise: null, city: null, state: null, updated_at: 'x' })).toMatchObject({ charge_inr: '0.00', free_above_inr: '', active: 'off', city: '' });
  });
});
