/**
 * Product records: types, statuses and the publication rules.
 * This module holds NO product data. Formulation records live in the database (server-side only) and reach the
 * browser only through /api/products (approved previews) or the authenticated admin API.
 */

export const PRODUCT_STATUSES = ['DRAFT', 'IN_DEVELOPMENT', 'UNDER_REVIEW', 'APPROVED_FOR_PREVIEW', 'APPROVED_FOR_SALE'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: 'Draft',
  IN_DEVELOPMENT: 'In development (internal)',
  UNDER_REVIEW: 'Under review',
  APPROVED_FOR_PREVIEW: 'Approved for preview',
  APPROVED_FOR_SALE: 'Approved for sale',
};

/** Statuses whose approved information may appear on the public website. */
export const PUBLIC_STATUSES: readonly ProductStatus[] = ['APPROVED_FOR_PREVIEW', 'APPROVED_FOR_SALE'];
export const isPublicStatus = (s: string): boolean => (PUBLIC_STATUSES as readonly string[]).includes(s);
export const isStatus = (s: unknown): s is ProductStatus => typeof s === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(s);

/** What the public sees for a previewed product. There is deliberately no internal name, price or purchase field. */
export interface PublicProduct {
  slug: string;
  name: string;
  form: string;
  packSize: string;
  /** "In Development" for previews, "Approved for sale" for products approved for sale. */
  statusLabel: string;
  description: string;
  image: { src: string; alt: string } | null;
  /** All approved photos in order (the first is the primary one). Empty when the product has none. */
  images: { src: string; alt: string }[];
  /** Active pack-size labels only. No price, SKU, tax or stock is ever public. */
  packSizes: string[];
  /** Present only when the manufacturer-approved composition has been verified for public release. */
  ingredients: string[] | null;
  subCompositions: Record<string, string[]> | null;
  preservatives: string[] | null;
  /** The supplied heading for the preservatives list (for example "Preservatives / Excipients"). */
  preservativeLabel: string;
  /** True only for a product approved for sale. Stock and price are still checked on the server at cart and checkout. */
  purchasable: boolean;
}

/** The full record, visible only through the authenticated admin API. */
export interface InternalProduct {
  id: string;
  slug: string;
  internal_name: string;
  form: string;
  pack_size: string;
  status: ProductStatus;
  ingredients: string[];
  sub_compositions: Record<string, string[]>;
  /** Null means the preservatives were not supplied and must be verified. */
  preservatives: string[] | null;
  preservative_label: string;
  notes: string;
  public_name: string | null;
  public_description: string | null;
  public_image: string | null;
  public_image_alt: string | null;
  ingredients_public: boolean;
  composition_verified: boolean;
  preservatives_verified: boolean;
  claims_reviewed: boolean;
  reviewed_by: string | null;
  sort_order: number;
  /** MRP in paise, inclusive of all taxes. Internal only: no price is public while commerce is off. */
  price_paise: number | null;
  country_of_origin: string;
  manufacturer_details: string | null;
  shelf_life: string | null;
  updated_at?: string;
}

/** Fields an admin may change. Everything else is read-only through the API. */
export interface ProductUpdate {
  status?: ProductStatus;
  public_name?: string | null;
  public_description?: string | null;
  public_image?: string | null;
  public_image_alt?: string | null;
  ingredients_public?: boolean;
  composition_verified?: boolean;
  preservatives_verified?: boolean;
  claims_reviewed?: boolean;
  reviewed_by?: string | null;
  internal_name?: string;
  form?: string;
  pack_size?: string;
  price_paise?: number | null;
  country_of_origin?: string;
  manufacturer_details?: string | null;
  shelf_life?: string | null;
}

/** Phrases that must never appear in public product text unless specific evidence is held and the code is changed on purpose. */
const BLOCKED_CLAIMS: { re: RegExp; why: string }[] = [
  { re: /ayush[\s-]*(approved|certified|licensed)/i, why: '"AYUSH approved" is an unsupported claim' },
  { re: /(government|govt\.?)[\s-]*(approved|certified)/i, why: '"Government approved" is an unsupported claim' },
  { re: /clinically[\s-]*(proven|tested|validated|verified)/i, why: '"Clinically proven/tested" is an unsupported claim' },
  { re: /gmp[\s-]*(certified|compliant|approved)/i, why: '"GMP certified" is an unsupported claim' },
  { re: /\b(cures?|cured|curing|treats?|treating|heals?|reverses?|eliminates?|prevents?)\b/i, why: 'it makes a treatment or cure claim' },
  { re: /(\bguarantee[sd]?\b|\b100\s?%|\brisk[\s-]*free\b|\bmiracle\b)/i, why: 'it makes an absolute or guarantee claim' },
  { re: /\b(side[\s-]*effects?[\s-]*free|no side effects?|completely safe)\b/i, why: 'it makes a safety claim' },
];

export function claimProblems(text: string | null | undefined): string[] {
  if (!text) return [];
  return BLOCKED_CLAIMS.filter((c) => c.re.test(text)).map((c) => c.why);
}

/** Public images must be self-hosted files in /public/images/products (the site's CSP allows only same-origin images). */
export const IMAGE_PATH_RE =
  /^(\/images\/products\/[a-z0-9][a-z0-9-]{0,80}|\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(webp|jpg|jpeg|png|avif)$/;

/** Images uploaded through the admin panel are stored privately and served by /api/media. Only the file name is kept. */
export const MEDIA_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/;
export const MAX_IMAGE_BYTES = 2_500_000;

/** Identify an image by its first bytes. The client-sent type or file name is never trusted. */
export function sniffImage(b: Uint8Array): 'webp' | 'jpg' | 'png' | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  if (b.length > 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (b.length > 3 && at(0, 0xff, 0xd8, 0xff)) return 'jpg';
  if (b.length > 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  return null;
}

export const MAX_PRICE_PAISE = 100_000_000; // Rs 10,00,000

/** "499" or "499.5" or "1,299.00" (rupees) to paise. Empty means no price. */
export function rupeesToPaise(input: string): { ok: true; value: number | null } | { ok: false } {
  const t = input.replace(/[,\s₹]/g, '');
  if (t === '') return { ok: true, value: null };
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return { ok: false };
  const paise = Math.round(Number(t) * 100);
  return paise > 0 && paise <= MAX_PRICE_PAISE ? { ok: true, value: paise } : { ok: false };
}

export function paiseToRupees(p: number | null | undefined): string {
  return typeof p === 'number' ? (p / 100).toFixed(2).replace(/\.00$/, '') : '';
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function validateUpdate(raw: unknown): { ok: true; update: ProductUpdate } | { ok: false; errors: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const b = raw as Record<string, unknown>;
  const errors: string[] = [];
  const update: ProductUpdate = {};
  const text = (key: keyof ProductUpdate, max: number) => {
    if (!(key in b)) return;
    const v = b[key];
    if (v === null) return void ((update as Record<string, unknown>)[key] = null);
    if (typeof v !== 'string' || v.length > max) return void errors.push(`${key} must be text of at most ${max} characters.`);
    (update as Record<string, unknown>)[key] = v.trim() === '' ? null : v.trim();
  };
  const bool = (key: keyof ProductUpdate) => {
    if (!(key in b)) return;
    if (typeof b[key] !== 'boolean') return void errors.push(`${key} must be true or false.`);
    (update as Record<string, unknown>)[key] = b[key];
  };
  if ('status' in b) {
    if (isStatus(b.status)) update.status = b.status;
    else errors.push('status is not a valid status.');
  }
  const required = (key: 'internal_name' | 'form' | 'pack_size' | 'country_of_origin', max: number) => {
    if (!(key in b)) return;
    const v = b[key];
    if (typeof v !== 'string' || v.trim() === '' || v.length > max) return void errors.push(`${key} must be text of 1 to ${max} characters.`);
    (update as Record<string, unknown>)[key] = v.trim();
  };
  required('internal_name', 120);
  required('form', 40);
  required('pack_size', 40);
  required('country_of_origin', 60);
  text('manufacturer_details', 400);
  text('shelf_life', 60);
  if ('price_paise' in b) {
    const v = b.price_paise;
    if (v === null) update.price_paise = null;
    else if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_PRICE_PAISE) update.price_paise = v;
    else errors.push('price_paise must be a whole number of paise between 1 and 100000000, or null.');
  }
  text('public_name', 80);
  text('public_description', 1200);
  text('public_image_alt', 200);
  text('reviewed_by', 120);
  if ('public_image' in b) {
    if (b.public_image === null || b.public_image === '') update.public_image = null;
    else if (typeof b.public_image === 'string' && IMAGE_PATH_RE.test(b.public_image)) update.public_image = b.public_image;
    else errors.push('public_image must be a file under /images/products/ (for example /images/products/iron-syrup.webp).');
  }
  bool('ingredients_public');
  bool('composition_verified');
  bool('preservatives_verified');
  bool('claims_reviewed');
  return errors.length ? { ok: false, errors } : { ok: true, update };
}

export interface NewProduct {
  slug: string;
  internal_name: string;
  form: string;
  pack_size: string;
  public_name: string | null;
  public_description: string | null;
  public_image: string | null;
  public_image_alt: string | null;
  price_paise: number | null;
  country_of_origin: string;
  manufacturer_details: string | null;
  shelf_life: string | null;
}

/** A new product always starts as a DRAFT with nothing public. Review flags are never accepted at creation. */
export function validateCreate(raw: unknown): { ok: true; product: NewProduct } | { ok: false; errors: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const b = raw as Record<string, unknown>;
  const errors: string[] = [];
  const str = (key: string, max: number, required: boolean): string | null => {
    const v = b[key];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (required) errors.push(`${key} is required.`);
      return null;
    }
    if (typeof v !== 'string' || v.length > max) {
      errors.push(`${key} must be text of at most ${max} characters.`);
      return null;
    }
    return v.trim();
  };
  const internal_name = str('internal_name', 120, true);
  const form = str('form', 40, true);
  const pack_size = str('pack_size', 40, true);
  const public_name = str('public_name', 80, false);
  const public_description = str('public_description', 1200, false);
  const public_image_alt = str('public_image_alt', 200, false);
  const manufacturer_details = str('manufacturer_details', 400, false);
  const shelf_life = str('shelf_life', 60, false);
  const country_of_origin = str('country_of_origin', 60, false) ?? 'India';
  const slugRaw = str('slug', 80, false);
  const slug = slugRaw ?? (internal_name ? slugify(internal_name) : '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) errors.push('slug must use lowercase letters, numbers and single hyphens.');

  let public_image: string | null = null;
  if (b.public_image !== undefined && b.public_image !== null && b.public_image !== '') {
    if (typeof b.public_image === 'string' && IMAGE_PATH_RE.test(b.public_image)) public_image = b.public_image;
    else errors.push('public_image must be an uploaded image or a file under /images/products/.');
  }
  let price_paise: number | null = null;
  if (b.price_paise !== undefined && b.price_paise !== null) {
    if (typeof b.price_paise === 'number' && Number.isInteger(b.price_paise) && b.price_paise > 0 && b.price_paise <= MAX_PRICE_PAISE) price_paise = b.price_paise;
    else errors.push('price_paise must be a whole number of paise between 1 and 100000000.');
  }
  for (const [label, value] of [['public name', public_name], ['public description', public_description]] as const) {
    for (const why of claimProblems(value)) errors.push(`The ${label} cannot be used: ${why}.`);
  }
  if (public_image && !public_image_alt) errors.push('An image needs descriptive alt text.');
  if (errors.length || !internal_name || !form || !pack_size) return { ok: false, errors: errors.length ? errors : ['Missing required fields.'] };
  return { ok: true, product: { slug, internal_name, form, pack_size, public_name, public_description, public_image, public_image_alt, price_paise, country_of_origin, manufacturer_details, shelf_life } };
}

/**
 * Everything standing between a record and a given status. An empty list means the change is allowed.
 * Hiding a product (moving to a non-public status) is always allowed, even if its text is poor; screening of text and
 * ingredient flags then applies only to what is being changed (opts), so a bad record can always be taken down.
 */
export function publishProblems(
  p: Pick<InternalProduct, 'public_name' | 'public_description' | 'public_image' | 'public_image_alt' | 'ingredients_public' | 'composition_verified' | 'preservatives_verified' | 'claims_reviewed' | 'reviewed_by' | 'preservatives'>,
  target: ProductStatus,
  opts: { screenText?: boolean; checkIngredients?: boolean } = {},
): string[] {
  const problems: string[] = [];
  const toPublic = isPublicStatus(target);
  const screenText = opts.screenText ?? toPublic;
  const checkIngredients = opts.checkIngredients ?? toPublic;

  if (screenText) {
    for (const [label, value] of [['public name', p.public_name], ['public description', p.public_description]] as const) {
      for (const why of claimProblems(value)) problems.push(`The ${label} cannot be used: ${why}.`);
    }
    if (p.public_image && !p.public_image_alt?.trim()) problems.push('A public image needs descriptive alt text.');
  }

  if (checkIngredients && p.ingredients_public) {
    if (!p.composition_verified) problems.push('Ingredients cannot be public until the manufacturer-approved composition is verified for public release.');
    if (!p.preservatives_verified) {
      problems.push(
        p.preservatives === null
          ? 'Preservatives were not supplied for this product and must be verified before the ingredient list is public.'
          : 'Preservatives must be verified before the ingredient list is public.',
      );
    }
  }

  // Approval for sale can now be set in admin. It needs the same review sign-off as a preview. It does not turn selling on:
  // checkout stays locked behind COMMERCE_ENABLED (shared/commerce.ts) until that switch is changed in code.
  if (toPublic) {
    if ((p.public_name ?? '').trim().length < 2) problems.push('A public name is required before a preview.');
    if ((p.public_description ?? '').trim().length < 20) problems.push('An approved public description (at least 20 characters) is required before a preview.');
    if (!p.claims_reviewed) problems.push('Confirm that the public text has been checked for regulatory and advertising claims.');
    if (!(p.reviewed_by ?? '').trim()) problems.push('Record who reviewed the public text.');
  }
  return problems;
}

/** Only these ever leave the server for the public. Maps a row of the public_products database view. */
export interface PublicViewRow {
  slug: string;
  name: string;
  form: string;
  pack_size: string;
  status: string;
  description: string;
  public_image: string | null;
  public_image_alt: string | null;
  ingredients: string[] | null;
  sub_compositions: Record<string, string[]> | null;
  preservatives: string[] | null;
  preservative_label?: string | null;
}

/** A row of the public_product_images view (only ever returned for publicly approved products). */
export interface PublicImageRow {
  slug: string;
  path: string;
  alt: string;
  sort_order: number;
}

export interface PublicExtras {
  images?: PublicImageRow[];
  /** Pack-size labels of active variants, already ordered. */
  packSizes?: string[];
}

export function toPublic(row: PublicViewRow, extras: PublicExtras = {}): PublicProduct {
  const primary = row.public_image && IMAGE_PATH_RE.test(row.public_image) && row.public_image_alt ? { src: row.public_image, alt: row.public_image_alt } : null;
  // The gallery is the source of truth; a product with no gallery rows falls back to its single legacy photo.
  const gallery = (extras.images ?? [])
    .filter((i) => i.slug === row.slug && IMAGE_PATH_RE.test(i.path) && i.alt)
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, 8)
    .map((i) => ({ src: i.path, alt: i.alt }));
  const images = gallery.length ? gallery : primary ? [primary] : [];
  const image = images[0] ?? null;
  const packSizes = extras.packSizes?.length ? extras.packSizes : [row.pack_size];
  const hasIngredients = Array.isArray(row.ingredients) && row.ingredients.length > 0;
  return {
    slug: row.slug,
    name: row.name,
    form: row.form,
    packSize: row.pack_size,
    statusLabel: row.status === 'APPROVED_FOR_SALE' ? 'Approved for sale' : 'In Development',
    description: row.description,
    image,
    images,
    packSizes,
    ingredients: hasIngredients ? row.ingredients : null,
    subCompositions: hasIngredients && row.sub_compositions && Object.keys(row.sub_compositions).length ? row.sub_compositions : null,
    preservatives: hasIngredients && Array.isArray(row.preservatives) && row.preservatives.length ? row.preservatives : null,
    preservativeLabel: row.preservative_label?.trim() || 'Preservatives',
    purchasable: row.status === 'APPROVED_FOR_SALE',
  };
}
