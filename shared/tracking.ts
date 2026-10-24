/**
 * Customer order tracking. Pure helpers. Only what the database returns is shown: no courier events are invented,
 * and an estimate is shown only when the shop recorded one.
 */
import { SHIPMENT_LABELS, isShipmentStatus, type ShipmentStatus } from './shipments.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const parseOrderId = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);

export interface TrackEvent { status: ShipmentStatus; label: string; note: string | null; location: string | null; at: string }
export interface TrackShipment {
  shipmentNo: string; status: ShipmentStatus; label: string; courier: string | null; trackingNo: string | null;
  estimatedDelivery: string | null; dispatchedAt: string | null; deliveredAt: string | null; events: TrackEvent[];
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whitelists fields from shipments_for_member(); unknown statuses and malformed rows are dropped, never guessed. */
export function shapeShipments(raw: unknown): TrackShipment[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackShipment[] = [];
  for (const s of raw) {
    if (!isRec(s) || !isShipmentStatus(s.status) || typeof s.shipment_no !== 'string') continue;
    const events: TrackEvent[] = [];
    if (Array.isArray(s.events)) {
      for (const e of s.events) {
        if (isRec(e) && isShipmentStatus(e.status) && typeof e.at === 'string') {
          events.push({ status: e.status, label: SHIPMENT_LABELS[e.status], note: str(e.note), location: str(e.location, 120), at: e.at });
        }
      }
    }
    out.push({
      shipmentNo: s.shipment_no.slice(0, 40), status: s.status, label: SHIPMENT_LABELS[s.status], courier: str(s.courier, 60),
      trackingNo: str(s.tracking_no, 60), estimatedDelivery: str(s.estimated_delivery, 40), dispatchedAt: str(s.dispatched_at, 40),
      deliveredAt: str(s.delivered_at, 40), events,
    });
  }
  return out;
}
