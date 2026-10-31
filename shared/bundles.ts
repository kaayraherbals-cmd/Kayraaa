/**
 * Bundles, gift sets, wishlists and recommendations (V5 Phase 10). Pure functions, no I/O.
 *
 * The AUTHORITY is the database (supabase/bundles_wishlists.sql). This file is the TypeScript twin of its arithmetic so tests can
 * check both against the same cases, plus input validation and the gift-message sanitiser. Money is integer paise (bigint-safe
 * integers below 2^53); division is integer floor, never floating point. Nothing here decides a price at checkout.
 */

export type BundleKind = 'bundle' | 'wellness_kit' | 'gift_set' | 'promo';
export type PricingMode = 'fixed_price' | 'percent_off' | 'amount_off';

export interface BundleComponent { variantId: string; qty: number }
export interface BundlePricing { mode: PricingMode; fixedPricePaise?: number; percentBps?: number; amountOffPaise?: number }
export interface BundlePrice { combinedPaise: number; discountPaise: number; finalPaise: number; savingsPaise: number }

export class BundleError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

/** Mirror of public.bundle_price_from. The percentage discount floors, so a customer never pays less than the owner configured. */
export function bundlePrice(p: BundlePricing, combinedPaise: number): BundlePrice {
  if (!isInt(combinedPaise) || combinedPaise <= 0) throw new BundleError('KH:INVALID');
  let finalPaise: number | null = null;
  if (p.mode === 'fixed_price' && isInt(p.fixedPricePaise)) finalPaise = p.fixedPricePaise;
  else if (p.mode === 'percent_off' && isInt(p.percentBps)) finalPaise = combinedPaise - Math.floor((combinedPaise * p.percentBps) / 10000);
  else if (p.mode === 'amount_off' && isInt(p.amountOffPaise)) finalPaise = combinedPaise - p.amountOffPaise;
  if (finalPaise === null || finalPaise <= 0) throw new BundleError('KH:BUNDLE_PRICE_INVALID');
  if (finalPaise > combinedPaise) throw new BundleError('KH:BUNDLE_NO_SAVING');
  return { combinedPaise, discountPaise: combinedPaise - finalPaise, finalPaise, savingsPaise: combinedPaise - finalPaise };
}

/** Mirror of public.bundle_alloc: largest remainder, ties to the lower index. The parts always add up to `amount` exactly. */
export function allocate(amount: number, weights: number[]): number[] {
  if (!isInt(amount) || amount < 0 || weights.length === 0 || weights.some((w) => !isInt(w) || w <= 0)) throw new BundleError('KH:INVALID');
  const total = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((amount * w) / total));
  const rem = weights.map((w) => (amount * w) % total);
  let left = amount - out.reduce((a, b) => a + b, 0);
  while (left > 0) {
    let best = 0;
    for (let j = 1; j < rem.length; j++) if (rem[j]! > rem[best]!) best = j;
    out[best]! += 1;
    rem[best] = -1;
    left -= 1;
  }
  return out;
}

/** Mirror of public.bundle_availability: MIN over components of floor(free / qty). Free units come from the server (batches that are
 * active, unexpired and outside the minimum-days window, less reservations). Missing stock counts as 0. */
export function bundleAvailability(components: BundleComponent[], freeByVariant: Record<string, number>): number {
  if (components.length < 2) return 0;
  return Math.min(...components.map((c) => Math.floor(Math.max(0, freeByVariant[c.variantId] ?? 0) / c.qty)));
}

/** Owner input check, before the database applies its own (authoritative) checks. Bundles hold variants only, never other bundles,
 * so a circular relationship cannot be expressed; a variant listed twice is refused instead of silently summed. */
export function validateBundleInput(input: { slug: string; name: string; kind?: BundleKind; pricing: BundlePricing; components: BundleComponent[]; giftMessageAllowed?: boolean }): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(input.slug)) errors.push('slug');
  if (input.name.trim().length < 2 || input.name.length > 120) errors.push('name');
  const ids = input.components.map((c) => c.variantId);
  if (input.components.length < 2) errors.push('components_min_two');
  if (new Set(ids).size !== ids.length) errors.push('components_duplicate');
  if (input.components.some((c) => !isInt(c.qty) || c.qty < 1 || c.qty > 10)) errors.push('component_qty');
  const set = [input.pricing.fixedPricePaise, input.pricing.percentBps, input.pricing.amountOffPaise].filter((v) => v !== undefined).length;
  if (set !== 1) errors.push('pricing_exactly_one_value');
  if (input.giftMessageAllowed && input.kind !== 'gift_set') errors.push('gift_message_needs_gift_set');
  return errors;
}

/** Gift message: plain text only, 1 to 200 characters after trimming. Control characters and angle brackets are removed so a message
 * can never carry markup, and the result must still be escaped wherever it is rendered. Returns null for empty input. */
export function sanitizeGiftMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (clean === '') return null;
  if (clean.length > 200) throw new BundleError('KH:GIFT_MESSAGE_TOO_LONG');
  return clean;
}

/** Guest wishlist merge: the member's list wins order, unknown or duplicate ids are dropped, and the result never exceeds `cap`. */
export function mergeWishlists(memberIds: string[], guestIds: string[], cap = 100): string[] {
  const out: string[] = [];
  for (const id of [...memberIds, ...guestIds]) if (!out.includes(id) && out.length < cap) out.push(id);
  return out;
}

export interface CoPurchasePair { orders: number }
/** Frequently bought together is shown only with at least `minOrders` real orders (never below 3). Otherwise the caller must show the
 * curated list under its own label, never under this one. */
export function frequentlyBoughtLabel(pair: CoPurchasePair | undefined, minOrders = 5): 'frequently_bought_together' | 'related' {
  return pair && pair.orders >= Math.max(minOrders, 3) ? 'frequently_bought_together' : 'related';
}

/** Raw database refusal codes to words a customer or owner can read. */
export function bundleMessage(code: string): string {
  const c = code.replace(/^KH:/, '').split(':')[0];
  switch (c) {
    case 'BUNDLE_COMPONENTS': return 'A bundle needs at least two different products that are all on sale.';
    case 'BUNDLE_PRICE_INVALID': return 'That bundle price is not valid.';
    case 'BUNDLE_NO_SAVING': return 'The bundle price must be lower than buying the items separately.';
    case 'BUNDLE_UNAVAILABLE': return 'This bundle is not available right now.';
    case 'BUNDLE_COUPON_EXCLUDED': return 'Coupons cannot be used on orders that contain a bundle.';
    case 'WISHLIST_FULL': return 'Your wishlist is full (100 products).';
    case 'GIFT_MESSAGE_TOO_LONG': return 'Gift messages can be up to 200 characters.';
    case 'PRICE_CHANGED': return 'A price changed. Please review your bag.';
    case 'INSUFFICIENT_STOCK': return 'Not enough stock for that bundle.';
    default: return 'Something went wrong. Please try again.';
  }
}
