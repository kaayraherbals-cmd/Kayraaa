import { describe, expect, it } from 'vitest';
import { delayedShipments, refundQueue } from './aiAnalytics';

describe('late shipments', () => {
  it('flags only shipments past their estimate, and failed deliveries', () => {
    const rows = [
      { shipment_no: 'S1', status: 'in_transit', estimated_delivery: '2026-10-18', dispatched_at: null },
      { shipment_no: 'S2', status: 'in_transit', estimated_delivery: '2026-10-25', dispatched_at: null },
      { shipment_no: 'S3', status: 'dispatched', estimated_delivery: null, dispatched_at: null },
      { shipment_no: 'S4', status: 'delivery_failed', estimated_delivery: '2026-10-21', dispatched_at: null },
    ];
    expect(delayedShipments(rows, '2026-10-22')).toEqual([{ shipment_no: 'S1', status: 'in_transit', daysLate: 4 }, { shipment_no: 'S4', status: 'delivery_failed', daysLate: 1 }]);
  });
});
describe('refund queue', () => {
  it('counts only requests the owner still has to act on', () => {
    expect(refundQueue([{ status: 'requested' }, { status: 'requested' }, { status: 'approved' }, { status: 'refunded' }, { status: 'rejected' }])).toEqual({ awaitingDecision: 2, approvedNotYetPaid: 1 });
  });
});
