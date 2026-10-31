import { evaluateLine, formatRupees, priceCart, type CartLineInput, type CartLineView, type VariantRecord } from './cart.js';

/**
 * Abandoned cart recovery (Phase 7). Pure functions only: no I/O, no environment, so the rules are tested without a database.
 * The authoritative eligibility checks live in supabase/cart_recovery.sql (they run inside the database, next to the data);
 * this file holds what the server does around them: settings validation, schedule maths, the price and stock re-check that
 * happens before a reminder is built, masking for the dashboard, and the metric definitions.
 */

/** Shown next to the opt-in switch and stored by version with the consent. Change the version when the wording changes. */
export const CONSENT_TEXT_VERSION = 'cart-reminders-v1';
export const CONSENT_TEXT =
  'Email me a reminder if I leave items in my bag. At most three emails per abandoned bag, only about the items I saved. I can switch this off at any time, here or with the unsubscribe link in each email.';

export interface RecoverySettings {
  enabled: boolean;
  paused: boolean;
  inactivityMinutes: number;
  /** Minutes after abandonment (last bag change + inactivity) at which reminder 1, 2 and 3 become due. */
  stepDelaysMinutes: [number, number, number];
  maxMessagesPerCycle: number;
  maxPerMember7d: number;
  minGapHours: number;
  batchSize: number;
  tokenTtlHours: number;
}

export const DEFAULT_SETTINGS: RecoverySettings = {
  enabled: false,
  paused: false,
  inactivityMinutes: 60,
  stepDelaysMinutes: [60, 1440, 4320],
  maxMessagesPerCycle: 3,
  maxPerMember7d: 3,
  minGapHours: 12,
  batchSize: 25,
  tokenTtlHours: 168,
};

/** Database column to API field. One table so the two can never drift apart. */
const COLUMNS: Record<string, keyof RecoverySettings> = {
  enabled: 'enabled',
  paused: 'paused',
  inactivity_minutes: 'inactivityMinutes',
  step_delays_minutes: 'stepDelaysMinutes',
  max_messages_per_cycle: 'maxMessagesPerCycle',
  max_per_member_7d: 'maxPerMember7d',
  min_gap_hours: 'minGapHours',
  batch_size: 'batchSize',
  token_ttl_hours: 'tokenTtlHours',
};
export const SETTINGS_SELECT = Object.keys(COLUMNS).join(',');

export function settingsFromRow(row: Record<string, unknown> | null | undefined): RecoverySettings {
  const out: RecoverySettings = { ...DEFAULT_SETTINGS, stepDelaysMinutes: [...DEFAULT_SETTINGS.stepDelaysMinutes] };
  if (!row) return out;
  const o = out as unknown as Record<string, unknown>;
  for (const [col, key] of Object.entries(COLUMNS)) if (row[col] !== undefined && row[col] !== null) o[key] = row[col];
  return out;
}

const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

export type SettingsUpdate = { ok: true; patch: Record<string, unknown>; changed: Partial<RecoverySettings> } | { ok: false; errors: string[] };

/**
 * Validates an owner's settings change. Only known fields are accepted; anything else is an error, never silently ignored.
 * The same limits exist as CHECK constraints in the database, so a bad value can never be stored even if this is bypassed.
 */
export function validateSettingsUpdate(raw: unknown): SettingsUpdate {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['Send the settings to change.'] };
  const b = raw as Record<string, unknown>;
  const errors: string[] = [];
  const patch: Record<string, unknown> = {};
  const changed: Partial<RecoverySettings> = {};
  const known = new Set(Object.values(COLUMNS) as string[]);
  for (const k of Object.keys(b)) if (!known.has(k)) errors.push(`Unknown setting: ${k.slice(0, 40)}.`);

  for (const k of ['enabled', 'paused'] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'boolean') errors.push(`${k} must be on or off.`);
    else {
      patch[k] = b[k];
      changed[k] = b[k] as boolean;
    }
  }
  const nums: [keyof RecoverySettings, string, number, number, string][] = [
    ['inactivityMinutes', 'inactivity_minutes', 15, 10080, 'Inactivity time must be 15 to 10,080 minutes.'],
    ['maxMessagesPerCycle', 'max_messages_per_cycle', 1, 3, 'Reminders per bag must be 1 to 3.'],
    ['maxPerMember7d', 'max_per_member_7d', 1, 10, 'Reminders per customer in 7 days must be 1 to 10.'],
    ['minGapHours', 'min_gap_hours', 1, 168, 'Minimum gap must be 1 to 168 hours.'],
    ['batchSize', 'batch_size', 1, 100, 'Batch size must be 1 to 100.'],
    ['tokenTtlHours', 'token_ttl_hours', 1, 720, 'Link validity must be 1 to 720 hours.'],
  ];
  for (const [key, col, min, max, msg] of nums) {
    if (b[key] === undefined) continue;
    const v = int(b[key], min, max);
    if (v === null) errors.push(msg);
    else {
      patch[col] = v;
      (changed as Record<string, unknown>)[key] = v;
    }
  }
  if (b.stepDelaysMinutes !== undefined) {
    const d = b.stepDelaysMinutes;
    const ok = Array.isArray(d) && d.length === 3 && d.every((x) => int(x, 1, 43200) !== null) && (d[0] as number) < (d[1] as number) && (d[1] as number) < (d[2] as number);
    if (!ok) errors.push('Give three reminder delays in minutes, each later than the one before (up to 43,200).');
    else {
      patch.step_delays_minutes = d;
      changed.stepDelaysMinutes = d as [number, number, number];
    }
  }
  if (errors.length) return { ok: false, errors };
  if (!Object.keys(patch).length) return { ok: false, errors: ['Nothing to change.'] };
  return { ok: true, patch, changed };
}

/** When each reminder becomes due. Abandonment is the last bag change plus the inactivity time. Mirrors cart_recovery_detect. */
export function scheduleDueTimes(lastActivityMs: number, s: Pick<RecoverySettings, 'inactivityMinutes' | 'stepDelaysMinutes' | 'maxMessagesPerCycle'>): number[] {
  const abandoned = lastActivityMs + s.inactivityMinutes * 60_000;
  return s.stepDelaysMinutes.slice(0, s.maxMessagesPerCycle).map((m) => abandoned + m * 60_000);
}

// ---- Price and stock re-check before a reminder is built or a bag is restored ------------------------------------------------

export interface RecoveryLine {
  variantId: string;
  productName: string;
  packSize: string;
  qty: number;
  unitPaise: number;
  lineTotalPaise: number;
  /** True when the quantity was lowered to what is in stock. */
  reduced: boolean;
}

export interface Assessment {
  /** Lines that can be bought right now, at today's price and stock. Never the price the customer saw earlier. */
  lines: RecoveryLine[];
  /** Lines that cannot be bought now. Names only, for the "no longer available" note. */
  unavailable: { productName: string; packSize: string }[];
  subtotalPaise: number;
  itemCount: number;
}

export function assessLines(saved: CartLineInput[], records: Map<string, VariantRecord>): Assessment {
  const { lines: views, totals } = priceCart(saved, records);
  const lines: RecoveryLine[] = [];
  const unavailable: Assessment['unavailable'] = [];
  for (const v of views as CartLineView[]) {
    if (v.state === 'unavailable') unavailable.push({ productName: v.productName, packSize: v.packSize });
    else lines.push({ variantId: v.variantId, productName: v.productName, packSize: v.packSize, qty: v.qty, unitPaise: v.unitPaise, lineTotalPaise: v.lineTotalPaise, reduced: v.state === 'adjusted' });
  }
  return { lines, unavailable, subtotalPaise: totals.subtotalPaise, itemCount: totals.itemCount };
}

/** A reminder is only worth sending when at least one item can still be bought. */
export const worthSending = (a: Assessment): boolean => a.lines.length > 0;

export { evaluateLine, formatRupees };

// ---- Outcomes ----------------------------------------------------------------------------------------------------------------

export type PreflightReason =
  | 'not_claimed' | 'disabled' | 'paused' | 'cycle_closed' | 'member_missing' | 'suppressed' | 'no_consent' | 'cart_empty' | 'cart_changed'
  | 'purchased' | 'checkout_active' | 'duplicate' | 'cycle_limit' | 'member_limit' | 'min_gap';

export interface PreflightResult {
  ok: boolean;
  defer?: boolean;
  reason?: string;
  email?: string;
  name?: string | null;
  member_id?: string;
  cycle_id?: string;
  step?: number;
  settings_ttl_hours?: number;
}

/** What to record for a failed pre-send check: wait and retry later, or end this reminder for good. */
export const preflightOutcome = (p: PreflightResult): { status: 'scheduled' | 'skipped'; reason: string } | null => {
  if (p.ok) return null;
  const reason = typeof p.reason === 'string' ? p.reason.slice(0, 40) : 'unknown';
  return { status: p.defer ? 'scheduled' : 'skipped', reason };
};

export type RedeemResult = 'ok' | 'invalid' | 'closed' | 'expired' | 'signin_required' | 'wrong_account';
export const REDEEM_RESULTS: readonly RedeemResult[] = ['ok', 'invalid', 'closed', 'expired', 'signin_required', 'wrong_account'];
export const asRedeemResult = (v: unknown): RedeemResult => ((REDEEM_RESULTS as readonly unknown[]).includes(v) ? (v as RedeemResult) : 'invalid');

// ---- Dashboard ---------------------------------------------------------------------------------------------------------------

/** a***@g***.com. The owner sees enough to recognise a customer they know, not enough to contact them from the dashboard. */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@') as [string, string];
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
}

export interface RecoveryStats {
  abandoned_carts: number;
  eligible_carts: number;
  emails_queued: number;
  emails_sent: number;
  delivery_failures: number;
  clicks: number;
  recovered_carts: number;
  recovered_orders: number;
  attributed_revenue_paise: number;
  emailed_carts: number;
  emailed_customers: number;
  unsubscribes_from_email: number;
  conversion_rate: number | null;
  unsubscribe_rate: number | null;
  top_products: { product: string; pack_size: string; carts: number }[];
}

export const METRIC_DEFINITIONS: Record<string, string> = {
  abandoned_carts: 'Bags last changed in the period, idle for at least the inactivity time, holding something buyable, not followed by an order, not in a checkout. Counted whether or not the customer agreed to reminders.',
  eligible_carts: 'Of those, bags that were opened for recovery: the customer agreed to reminders and has not unsubscribed.',
  emails_queued: 'Reminders scheduled in the period.',
  emails_sent: 'Reminders the email provider accepted in the period.',
  delivery_failures: 'Reminders that could not be sent after three tries. Provider acceptance is not proof of delivery to an inbox.',
  clicks: 'Reminders whose link was opened by the signed-in owner of the bag. Mail scanners and link previews do not count.',
  recovered_orders: 'Paid orders placed within the attribution window after a click, counted once each.',
  attributed_revenue: 'Total of those orders. This is ATTRIBUTED revenue: the customer clicked, then paid. It is not proven extra revenue, because some of them might have bought anyway.',
  conversion_rate: 'Recovered bags divided by bags that were emailed in the period.',
  unsubscribe_rate: 'Unsubscribes made through a reminder email divided by customers emailed in the period.',
};

export const formatRate = (r: number | null | undefined): string => (typeof r === 'number' && Number.isFinite(r) ? `${(r * 100).toFixed(1)}%` : 'n/a');
export const formatRevenue = (paise: number): string => formatRupees(Math.max(0, Math.trunc(paise)));

/** Cleans what the database returned so a malformed row can never put NaN on the dashboard. */
export function normaliseStats(raw: unknown): RecoveryStats {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const n = (k: string): number => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? (o[k] as number) : 0);
  const rate = (k: string): number | null => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? (o[k] as number) : null);
  const top = Array.isArray(o.top_products) ? (o.top_products as Record<string, unknown>[]).slice(0, 10).map((t) => ({ product: String(t.product ?? '').slice(0, 120), pack_size: String(t.pack_size ?? '').slice(0, 40), carts: Number(t.carts) || 0 })) : [];
  return {
    abandoned_carts: n('abandoned_carts'), eligible_carts: n('eligible_carts'), emails_queued: n('emails_queued'), emails_sent: n('emails_sent'),
    delivery_failures: n('delivery_failures'), clicks: n('clicks'), recovered_carts: n('recovered_carts'), recovered_orders: n('recovered_orders'),
    attributed_revenue_paise: n('attributed_revenue_paise'), emailed_carts: n('emailed_carts'), emailed_customers: n('emailed_customers'),
    unsubscribes_from_email: n('unsubscribes_from_email'), conversion_rate: rate('conversion_rate'), unsubscribe_rate: rate('unsubscribe_rate'), top_products: top,
  };
}
