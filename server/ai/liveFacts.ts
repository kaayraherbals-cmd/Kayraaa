import { isValidPin } from '../../shared/checkout.js';
import { formatInr } from '../../shared/orders.js';
import { loadShippingRow } from '../checkout.js';
import type { SupabaseConfig } from '../supabase.js';

/**
 * Facts the assistant can only get from the shop's own systems, not from page text:
 *  - whether Kaayra delivers to a PIN code the customer typed, and the delivery charge (the same table checkout uses);
 *  - the contact details the owner set up for the site (email, phone, address), only when they exist.
 * Nothing here is written by the model. A database problem is reported as "could not check", never as "we deliver".
 */
export interface DeliveryFact { pincode: string; delivers: boolean | 'could not check'; delivery_charge?: string; free_delivery_above?: string }

const PIN_RE = /(?<![0-9])[1-9][0-9]{5}(?![0-9])/g;
export const pinsIn = (message: string): string[] => [...new Set((message.match(PIN_RE) ?? []).filter(isValidPin))].slice(0, 2);

export async function deliveryFacts(db: SupabaseConfig, message: string, withPrices: boolean): Promise<DeliveryFact[]> {
  const pins = pinsIn(message);
  const out: DeliveryFact[] = [];
  for (const pin of pins) {
    try {
      const row = await loadShippingRow(db, pin);
      if (!row || !row.active) { out.push({ pincode: pin, delivers: false }); continue; }
      out.push({
        pincode: pin,
        delivers: true,
        ...(withPrices ? { delivery_charge: row.ratePaise === 0 ? 'free' : formatInr(row.ratePaise) } : {}),
        ...(withPrices && row.freeAbovePaise !== null ? { free_delivery_above: formatInr(row.freeAbovePaise) } : {}),
      });
    } catch {
      out.push({ pincode: pin, delivers: 'could not check' });
    }
  }
  return out;
}

/** Contact details from the site's own settings. Empty when the owner has not set any (the assistant then points to the Contact page form). */
export function contactFacts(env: Record<string, string | undefined>): Record<string, string> {
  const pick = (v: string | undefined): string => (typeof v === 'string' ? v.trim() : '');
  const facts: Record<string, string> = {};
  const email = pick(env.VITE_CONTACT_EMAIL);
  const phone = pick(env.VITE_CONTACT_PHONE);
  const address = pick(env.VITE_CONTACT_ADDRESS);
  if (email) facts.email = email;
  if (phone) facts.phone = phone;
  if (address) facts.address = address;
  return facts;
}
