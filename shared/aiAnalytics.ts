import { daysBetween, todayIST } from './inventory.js';

/**
 * Only the figures Kaayra Intelligence needs that no existing module provides (late shipments and the refund queue). Revenue, profit,
 * refunds in money, stock health and forecasts all come from the existing services (server/financeService.ts, shared/analytics.ts), so the
 * assistant can never disagree with the owner's own screens.
 */
export interface ShipmentRow { shipment_no: string; status: string; estimated_delivery: string | null; dispatched_at: string | null }

/** In motion and past its estimated date, or a delivery that failed. Shipments with no estimate are not guessed at. */
export function delayedShipments(rows: readonly ShipmentRow[], today = todayIST()): { shipment_no: string; status: string; daysLate: number }[] {
  const out: { shipment_no: string; status: string; daysLate: number }[] = [];
  for (const r of rows) {
    if (r.status === 'delivery_failed') out.push({ shipment_no: r.shipment_no, status: r.status, daysLate: r.estimated_delivery ? Math.max(0, daysBetween(r.estimated_delivery, today)) : 0 });
    else if (['dispatched', 'in_transit', 'out_for_delivery'].includes(r.status) && r.estimated_delivery && daysBetween(r.estimated_delivery, today) > 0) out.push({ shipment_no: r.shipment_no, status: r.status, daysLate: daysBetween(r.estimated_delivery, today) });
  }
  return out.sort((a, b) => b.daysLate - a.daysLate);
}

/** Counts of refunds still waiting on the owner. (Money comes from the finance service.) */
export function refundQueue(rows: readonly { status: string }[]): { awaitingDecision: number; approvedNotYetPaid: number } {
  let awaitingDecision = 0, approvedNotYetPaid = 0;
  for (const r of rows) {
    if (r.status === 'requested') awaitingDecision += 1;
    else if (r.status === 'approved') approvedNotYetPaid += 1;
  }
  return { awaitingDecision, approvedNotYetPaid };
}
