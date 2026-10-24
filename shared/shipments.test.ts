import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHIPMENT_STATUSES, canTransition, isFinal, nextStatuses, validateCreate, validateStatusChange, remainingToShip } from './shipments.js';

const sql = readFileSync(new URL('../supabase/shipments.sql', import.meta.url), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('shipment transitions', () => {
  it('match the database function pair for pair', () => {
    const body = /shipment_transition_ok[\s\S]*?select \(p_from, p_to\) in \(([\s\S]*?)\);/.exec(sql)![1];
    const sqlPairs = new Set([...body.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}`));
    const tsPairs = new Set<string>();
    for (const a of SHIPMENT_STATUSES) for (const b of SHIPMENT_STATUSES) if (canTransition(a, b)) tsPairs.add(`${a}>${b}`);
    expect([...tsPairs].sort()).toEqual([...sqlPairs].sort());
  });
  it('treats delivered, returned and cancelled as final', () => {
    for (const s of ['delivered', 'returned', 'cancelled'] as const) expect(isFinal(s)).toBe(true);
    expect(nextStatuses('delivered')).toEqual([]);
  });
  it('cannot skip dispatch, go backwards or leave a final state', () => {
    expect(canTransition('pending', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'in_transit')).toBe(false);
    expect(canTransition('returned', 'delivered')).toBe(false);
    expect(canTransition('dispatched', 'pending')).toBe(false);
  });
  it('allows a failed delivery to retry or return to origin', () => {
    expect(canTransition('delivery_failed', 'out_for_delivery')).toBe(true);
    expect(canTransition('delivery_failed', 'return_to_origin')).toBe(true);
    expect(canTransition('return_to_origin', 'returned')).toBe(true);
  });
});

describe('create validation', () => {
  it('needs an order and at least one item with a whole quantity', () => {
    expect(validateCreate({}).ok).toBe(false);
    expect(validateCreate({ order_id: A, items: [] }).ok).toBe(false);
    expect(validateCreate({ order_id: A, items: [{ order_item_id: B, qty: 1.5 }] }).ok).toBe(false);
    expect(validateCreate({ order_id: A, items: [{ order_item_id: B, qty: 0 }] }).ok).toBe(false);
    expect(validateCreate({ order_id: A, items: [{ order_item_id: B, qty: 2 }] }).ok).toBe(true);
  });
  it('rejects the same item twice and bad ids', () => {
    expect(validateCreate({ order_id: A, items: [{ order_item_id: B, qty: 1 }, { order_item_id: B, qty: 1 }] }).ok).toBe(false);
    expect(validateCreate({ order_id: 'nope', items: [{ order_item_id: B, qty: 1 }] }).ok).toBe(false);
  });
});

describe('status change validation', () => {
  const base = { shipment_id: A };
  it('refuses an illegal move with a plain message', () => {
    const r = validateStatusChange({ ...base, status: 'delivered' }, 'pending');
    expect(r.ok).toBe(false);
  });
  it('needs a courier and tracking number to dispatch', () => {
    expect(validateStatusChange({ ...base, status: 'dispatched' }, 'pending').ok).toBe(false);
    expect(validateStatusChange({ ...base, status: 'dispatched', courier: 'X', tracking_no: '' }, 'pending').ok).toBe(false);
    const ok = validateStatusChange({ ...base, status: 'dispatched', courier: ' Blue  Dart ', tracking_no: 'AB123' }, 'pending');
    expect(ok.ok && ok.value.courier).toBe('Blue Dart');
  });
  it('needs a reason for a failed delivery', () => {
    expect(validateStatusChange({ ...base, status: 'delivery_failed' }, 'in_transit').ok).toBe(false);
    expect(validateStatusChange({ ...base, status: 'delivery_failed', exception: 'refused' }, 'in_transit').ok).toBe(true);
    expect(validateStatusChange({ ...base, status: 'delivery_failed', exception: 'made_up' }, 'in_transit').ok).toBe(false);
  });
  it('checks the estimated date and strips control characters from notes', () => {
    expect(validateStatusChange({ ...base, status: 'in_transit', estimated_delivery: '31-12-2026' }, 'dispatched').ok).toBe(false);
    const r = validateStatusChange({ ...base, status: 'in_transit', note: 'a\r\nb', estimated_delivery: '2026-12-31' }, 'dispatched');
    expect(r.ok && r.value.note).toBe('a b');
  });
});

describe('the migration', () => {
  it('is additive, keeps history append-only and exposes nothing to anon or authenticated', () => {
    expect(sql).not.toMatch(/drop table|truncate|delete from public\.(orders|shipments)/i);
    expect(sql).toContain('shipment_events is append-only');
    for (const t of ['shipments', 'shipment_items', 'shipment_events', 'delivery_exceptions']) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
    expect(sql).toMatch(/revoke all on public\.shipments[^;]*from anon, authenticated/);
    expect(sql).toContain('o.member_id = p_member');
  });
});

describe('remainingToShip', () => {
  const lines = [{ id: 'a', qty: 3 }, { id: 'b', qty: 1 }];
  it('subtracts live shipments only', () => {
    const r = remainingToShip(lines, [
      { status: 'dispatched', shipment_items: [{ order_item_id: 'a', qty: 2 }] },
      { status: 'cancelled', shipment_items: [{ order_item_id: 'b', qty: 1 }] },
    ]);
    expect(r).toEqual({ a: 1, b: 1 });
  });
  it('never goes below zero', () => {
    expect(remainingToShip(lines, [{ status: 'pending', shipment_items: [{ order_item_id: 'b', qty: 5 }] }]).b).toBe(0);
  });
});
