/**
 * Pack-size variants. A product (one formulation) has one or more variants, each with its own SKU, MRP and stock.
 * Pack sizes are shown on the public site as labels only; price, SKU, tax and stock stay internal while selling is off.
 */
export const VARIANT_STATUSES = ['active', 'inactive'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];
export const MAX_VARIANTS_PER_PRODUCT = 8;
/** GST slabs that can apply to goods. The right one for each product is a question for your tax adviser. */
export const GST_RATES = [0, 3, 5, 12, 18, 28] as const;
export const MAX_VARIANT_PRICE_PAISE = 100_000_000;

export interface Variant {
  id: string;
  product_id: string;
  sku: string;
  pack_size: string;
  price_paise: number | null;
  gst_rate: number | null;
  hsn_code: string | null;
  barcode: string | null;
  low_stock_threshold: number;
  status: VariantStatus;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

const SKU_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const HSN_RE = /^\d{4}(\d{2}(\d{2})?)?$/;
const BARCODE_RE = /^\d{8,14}$/;

/** "iron-syrup" + "150 ml" gives "IRON-SYRUP-150ML". The database enforces uniqueness. */
export function makeSku(productSlug: string, packSize: string): string {
  const a = productSlug.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const b = packSize.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return `${a}-${b}`.replace(/-+$/g, '').slice(0, 40).replace(/-+$/g, '');
}

type Fail = { ok: false; errors: string[] };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface VariantFields {
  sku?: string;
  pack_size?: string;
  price_paise?: number | null;
  gst_rate?: number | null;
  hsn_code?: string | null;
  barcode?: string | null;
  low_stock_threshold?: number;
  status?: VariantStatus;
  sort_order?: number;
}

/** Fields that set money or tax. Changing them needs the products.price permission (owner). */
export const PRICE_FIELDS = ['price_paise', 'gst_rate', 'hsn_code'] as const;
export const touchesPrice = (u: VariantFields): boolean => PRICE_FIELDS.some((k) => k in u);

function parse(raw: unknown, creating: boolean): { ok: true; value: VariantFields } | Fail {
  if (!isObj(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const errors: string[] = [];
  const v: VariantFields = {};
  const has = (k: string) => k in raw;
  if (has('pack_size') || creating) {
    const s = raw.pack_size;
    if (typeof s === 'string' && s.trim() !== '' && s.trim().length <= 40) v.pack_size = s.trim();
    else errors.push('Pack size must be 1 to 40 characters, for example "200 ml" or "30 capsules".');
  }
  if (has('sku') && raw.sku !== undefined && raw.sku !== null && raw.sku !== '') {
    const s = typeof raw.sku === 'string' ? raw.sku.trim().toUpperCase() : '';
    if (SKU_RE.test(s)) v.sku = s;
    else errors.push('SKU must be 3 to 40 characters: capital letters, numbers and hyphens.');
  }
  if (has('price_paise')) {
    const p = raw.price_paise;
    if (p === null) v.price_paise = null;
    else if (typeof p === 'number' && Number.isInteger(p) && p > 0 && p <= MAX_VARIANT_PRICE_PAISE) v.price_paise = p;
    else errors.push('Price must be a whole number of paise between 1 and 100000000, or empty.');
  }
  if (has('gst_rate')) {
    const g = raw.gst_rate;
    if (g === null) v.gst_rate = null;
    else if (typeof g === 'number' && (GST_RATES as readonly number[]).includes(g)) v.gst_rate = g;
    else errors.push(`GST rate must be one of ${GST_RATES.join(', ')} percent, or empty.`);
  }
  if (has('hsn_code')) {
    const h = raw.hsn_code;
    if (h === null || h === '') v.hsn_code = null;
    else if (typeof h === 'string' && HSN_RE.test(h.trim())) v.hsn_code = h.trim();
    else errors.push('HSN code must be 4, 6 or 8 digits, or empty.');
  }
  if (has('barcode')) {
    const b = raw.barcode;
    if (b === null || b === '') v.barcode = null;
    else if (typeof b === 'string' && BARCODE_RE.test(b.trim())) v.barcode = b.trim();
    else errors.push('Barcode must be 8 to 14 digits, or empty.');
  }
  if (has('low_stock_threshold')) {
    const t = raw.low_stock_threshold;
    if (typeof t === 'number' && Number.isInteger(t) && t >= 0 && t <= 100_000) v.low_stock_threshold = t;
    else errors.push('The low-stock level must be a whole number from 0 to 100000.');
  }
  if (has('status')) {
    if (raw.status === 'active' || raw.status === 'inactive') v.status = raw.status;
    else errors.push('Status must be active or inactive.');
  }
  if (has('sort_order')) {
    const o = raw.sort_order;
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0 && o <= 10_000) v.sort_order = o;
    else errors.push('Order must be a whole number from 0 to 10000.');
  }
  if (errors.length) return { ok: false, errors };
  if (!creating && Object.keys(v).length === 0) return { ok: false, errors: ['Nothing to change.'] };
  return { ok: true, value: v };
}

export const validateVariantCreate = (raw: unknown) => parse(raw, true);
export const validateVariantUpdate = (raw: unknown) => parse(raw, false);

/** What the public site may learn about a variant: its pack size and nothing else. */
export const publicPackSizes = (variants: Pick<Variant, 'pack_size' | 'status' | 'sort_order'>[]): string[] => {
  const seen = new Set<string>();
  return [...variants]
    .filter((v) => v.status === 'active')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((v) => v.pack_size)
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
};
