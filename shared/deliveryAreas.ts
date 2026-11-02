import { isValidPin } from './checkout.js';

/**
 * Delivery areas: the rows of public.shipping_pincodes that the admin edits (supabase/delivery_areas.sql adds city and state).
 * Checkout reads only pincode, active, rate_paise and free_above_paise (shared/checkout.ts quoteShipping); the city and
 * state are a label for the people running the shop and are never used to decide whether we can deliver.
 *
 * Limits match the database checks: rate 0 to 10,000 rupees, free-delivery amount above zero or empty (empty means never free).
 */
export const MAX_RATE_PAISE = 1_000_000;
export const MAX_FREE_ABOVE_PAISE = 100_000_000; // 10 lakh rupees; the column is a bigint, this only stops typing mistakes
export const MAX_BULK_PINS = 2000;
export const MAX_LABEL = 60;

export interface DeliveryAreaRow {
  pincode: string;
  active: boolean;
  rate_paise: number;
  free_above_paise: number | null;
  city: string | null;
  state: string | null;
  updated_at: string;
}

/** Letters, digits, spaces and . ' - & ( ) , only; no control characters, markup or quotes that could end up in a filter or CSV. */
const LABEL_RE = /^[\p{L}\p{N} .'’&(),-]+$/u;

export function cleanLabel(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  const t = raw.replace(/\s+/g, ' ').trim();
  if (t === '') return { ok: true, value: null };
  return t.length <= MAX_LABEL && LABEL_RE.test(t) ? { ok: true, value: t } : { ok: false };
}

export const isRatePaise = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_RATE_PAISE;
export const isFreeAbovePaise = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_FREE_ABOVE_PAISE);

/** Rupees typed by a person ("60", "1,499.50") to paise. Unlike a price, zero is allowed (delivery can be free). Empty is null. */
export function rupeesToPaiseOrZero(input: string): { ok: true; value: number | null } | { ok: false } {
  const t = input.replace(/[,\s₹]/g, '');
  if (t === '') return { ok: true, value: null };
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return { ok: false };
  return { ok: true, value: Math.round(Number(t) * 100) };
}

export type AreaInput = { pincode: string; active: boolean; ratePaise: number; freeAbovePaise: number | null; city: string | null; state: string | null };
type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** One area, as sent to "add". Every field is checked again here even though the browser checks it too. */
export function validateAreaCreate(raw: unknown): Result<AreaInput> {
  const b = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: string[] = [];
  const pincode = typeof b.pincode === 'string' ? b.pincode.trim() : '';
  if (!isValidPin(pincode)) errors.push('Enter a valid 6-digit PIN code.');
  if (!isRatePaise(b.ratePaise)) errors.push('Delivery charge must be between ₹0 and ₹10,000.');
  const free = b.freeAbovePaise === undefined ? null : b.freeAbovePaise;
  if (!isFreeAbovePaise(free)) errors.push('Free-delivery amount must be above ₹0 and at most ₹10,00,000, or empty for never free.');
  if (b.active !== undefined && typeof b.active !== 'boolean') errors.push('Active must be on or off.');
  const city = cleanLabel(b.city);
  if (!city.ok) errors.push(`City can use letters, numbers and . ' - & ( ) , only, up to ${MAX_LABEL} characters.`);
  const state = cleanLabel(b.state);
  if (!state.ok) errors.push(`State can use letters, numbers and . ' - & ( ) , only, up to ${MAX_LABEL} characters.`);
  if (errors.length || !city.ok || !state.ok) return { ok: false, errors };
  return { ok: true, value: { pincode, active: b.active !== false, ratePaise: b.ratePaise as number, freeAbovePaise: free as number | null, city: city.value, state: state.value } };
}

export interface AreaUpdate {
  active?: boolean;
  rate_paise?: number;
  free_above_paise?: number | null;
  city?: string | null;
  state?: string | null;
}

/** A partial change to one area (toggle, or edit). Unknown fields are refused rather than ignored, so a typo is not a silent no-op. */
export function validateAreaUpdate(raw: unknown): Result<AreaUpdate> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['Nothing to change.'] };
  const b = raw as Record<string, unknown>;
  const allowed = ['active', 'ratePaise', 'freeAbovePaise', 'city', 'state'];
  const errors: string[] = [];
  for (const k of Object.keys(b)) if (!allowed.includes(k)) errors.push(`Unknown field "${k.slice(0, 30)}".`);
  const u: AreaUpdate = {};
  if ('active' in b) {
    if (typeof b.active === 'boolean') u.active = b.active;
    else errors.push('Active must be on or off.');
  }
  if ('ratePaise' in b) {
    if (isRatePaise(b.ratePaise)) u.rate_paise = b.ratePaise;
    else errors.push('Delivery charge must be between ₹0 and ₹10,000.');
  }
  if ('freeAbovePaise' in b) {
    if (isFreeAbovePaise(b.freeAbovePaise)) u.free_above_paise = b.freeAbovePaise;
    else errors.push('Free-delivery amount must be above ₹0 and at most ₹10,00,000, or empty for never free.');
  }
  for (const f of ['city', 'state'] as const) {
    if (!(f in b)) continue;
    const c = cleanLabel(b[f]);
    if (c.ok) u[f] = c.value;
    else errors.push(`${f === 'city' ? 'City' : 'State'} can use letters, numbers and . ' - & ( ) , only, up to ${MAX_LABEL} characters.`);
  }
  if (errors.length) return { ok: false, errors };
  if (Object.keys(u).length === 0) return { ok: false, errors: ['Nothing to change.'] };
  return { ok: true, value: u };
}

/* ------------------------------------------------------------ bulk paste ------------------------------------------------------------ */

export interface BulkEntry {
  pincode: string;
  city: string | null;
  state: string | null;
}
export interface BulkProblem {
  line: number;
  text: string;
  reason: string;
}
export interface BulkParse {
  entries: BulkEntry[];
  problems: BulkProblem[];
  /** PIN codes that appeared more than once; the first occurrence is kept. */
  duplicates: number;
}

const PIN_SHAPE = /^\d{6}$/;

/**
 * Reads pasted text, one line per area. Accepted line shapes:
 *   221005                          just a PIN
 *   221005, Varanasi, Uttar Pradesh PIN, city, state (comma or tab between them)
 *   221005 221006 221007            several PINs on one line (spaces, commas or semicolons)
 * A line that does not fit a shape is reported with its line number, and the caller applies nothing until the text is fixed.
 * City and state on a line win over the shared ones the caller may apply to every PIN.
 */
export function parseBulk(text: string): BulkParse {
  const entries: BulkEntry[] = [];
  const problems: BulkProblem[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const push = (pincode: string, city: string | null, state: string | null) => {
    if (seen.has(pincode)) {
      duplicates++;
      return;
    }
    seen.add(pincode);
    entries.push({ pincode, city, state });
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    const n = i + 1;
    const shown = line.length > 60 ? `${line.slice(0, 57)}...` : line;
    const bad = (reason: string) => problems.push({ line: n, text: shown, reason });
    // Several PINs on one line: every token is six digits.
    const loose = line.split(/[\s,;]+/).filter(Boolean);
    if (loose.length > 1 && loose.every((t) => PIN_SHAPE.test(t))) {
      for (const t of loose) {
        if (isValidPin(t)) push(t, null, null);
        else bad(`${t} is not a valid PIN code.`);
      }
      return;
    }
    const parts = line.split(/[,\t]/).map((s) => s.trim());
    const pin = parts[0];
    if (!PIN_SHAPE.test(pin)) return bad('Each line must start with a 6-digit PIN code.');
    if (!isValidPin(pin)) return bad(`${pin} is not a valid PIN code.`);
    if (parts.length > 3) return bad('Use PIN, city, state: at most three parts per line.');
    const city = cleanLabel(parts[1] ?? '');
    const state = cleanLabel(parts[2] ?? '');
    if (!city.ok || !state.ok) return bad('City or state has characters that are not allowed.');
    push(pin, city.value, state.value);
  });
  if (entries.length + problems.length > MAX_BULK_PINS) {
    return { entries: [], problems: [{ line: 0, text: '', reason: `Paste at most ${MAX_BULK_PINS} PIN codes at a time.` }], duplicates };
  }
  return { entries, problems, duplicates };
}

export interface BulkRequest {
  text: string;
  ratePaise: number;
  freeAbovePaise: number | null;
  active: boolean;
  city: string | null;
  state: string | null;
  onExisting: 'update' | 'skip';
  /** Count what would be new and what already exists, and change nothing. */
  dryRun: boolean;
}

export function validateBulk(raw: unknown): Result<{ req: BulkRequest; parsed: BulkParse }> {
  const b = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: string[] = [];
  const text = typeof b.text === 'string' ? b.text : '';
  if (text.length > 100_000) errors.push('That is too much text. Paste at most 2000 PIN codes at a time.');
  if (!isRatePaise(b.ratePaise)) errors.push('Delivery charge must be between ₹0 and ₹10,000.');
  const free = b.freeAbovePaise === undefined ? null : b.freeAbovePaise;
  if (!isFreeAbovePaise(free)) errors.push('Free-delivery amount must be above ₹0 and at most ₹10,00,000, or empty for never free.');
  if (typeof b.active !== 'boolean') errors.push('Choose whether these PIN codes are on or off.');
  if (b.onExisting !== 'update' && b.onExisting !== 'skip') errors.push('Choose what to do with PIN codes that already exist.');
  const city = cleanLabel(b.city);
  const state = cleanLabel(b.state);
  if (!city.ok || !state.ok) errors.push('City or state has characters that are not allowed.');
  if (errors.length || !city.ok || !state.ok) return { ok: false, errors };
  const parsed = parseBulk(text);
  if (parsed.problems.length) return { ok: false, errors: parsed.problems.slice(0, 20).map((p) => (p.line ? `Line ${p.line}: ${p.reason}` : p.reason)) };
  if (parsed.entries.length === 0) return { ok: false, errors: ['Paste at least one PIN code.'] };
  return {
    ok: true,
    value: {
      parsed,
      req: { text, ratePaise: b.ratePaise as number, freeAbovePaise: free as number | null, active: b.active as boolean, city: city.value, state: state.value, onExisting: b.onExisting as 'update' | 'skip', dryRun: b.dryRun === true },
    },
  };
}

export const DELIVERY_CSV_HEADERS = ['pincode', 'city', 'state', 'charge_inr', 'free_above_inr', 'active', 'updated_at'] as const;
export function deliveryCsvRow(r: DeliveryAreaRow): Record<string, unknown> {
  return {
    pincode: r.pincode,
    city: r.city ?? '',
    state: r.state ?? '',
    charge_inr: (r.rate_paise / 100).toFixed(2),
    free_above_inr: r.free_above_paise === null ? '' : (r.free_above_paise / 100).toFixed(2),
    active: r.active ? 'on' : 'off',
    updated_at: r.updated_at,
  };
}
