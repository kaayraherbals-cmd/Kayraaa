import { describe, expect, it } from 'vitest';
import { parseOrderId, shapeShipments } from './tracking.js';

describe('tracking', () => {
  it('accepts only uuids', () => {
    expect(parseOrderId('7b3f6c1e-2a4d-4e8b-9c1a-0d2e3f4a5b6c')).not.toBeNull();
    for (const v of ['', 'abc', 1, null, "x' or 1=1", '7b3f6c1e-2a4d-4e8b-9c1a']) expect(parseOrderId(v)).toBeNull();
  });
  it('whitelists fields and drops unknown statuses and junk', () => {
    const r = shapeShipments([
      { shipment_no: 'SH-1', status: 'in_transit', courier: 'X', tracking_no: 'T1', secret: 'no', events: [{ status: 'dispatched', at: '2026-01-01T00:00:00Z', note: 'ok' }, { status: 'teleported', at: 'x' }] },
      { shipment_no: 'SH-2', status: 'bogus' },
      'junk',
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.label).toBe('In transit');
    expect(r[0]!.events).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(r[0]!.estimatedDelivery).toBeNull();
  });
  it('returns an empty list for non-arrays', () => expect(shapeShipments(null)).toEqual([]));
});
