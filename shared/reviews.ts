import { sniffImage } from './products.js';

/**
 * Review rules shared by the API, the admin API and the tests. Policy (also in supabase/reviews.sql, docs/PHASE6_REVIEWS.md):
 * verified purchase = own, delivered, paid (captured), non-test order of the product; one review per customer per product;
 * text-only reviews publish at once; photos or a health-claim flag hold the review as PENDING for a person; staff never edit text or stars.
 */
export const REVIEW_STATUSES = ['PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED', 'WITHDRAWN'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const MODERATION_ACTIONS = ['approve', 'hide', 'reject', 'restore'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];
export const REPORT_REASONS = ['spam', 'harassment', 'personal_information', 'misleading', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  personal_information: 'Personal information',
  misleading: 'Misleading content',
  inappropriate: 'Inappropriate content',
  other: 'Other policy violation',
};

export const TITLE_MIN = 3;
export const TITLE_MAX = 100;
export const BODY_MIN = 10;
export const BODY_MAX = 2000;
export const REPLY_MIN = 5;
export const REPLY_MAX = 1000;
export const MAX_REVIEW_IMAGES = 3;
export const MAX_REVIEW_IMAGE_BYTES = 2_000_000;
export const PUBLIC_PAGE_SIZE = 10;
export const SORTS = ['recent', 'highest', 'lowest'] as const;
export type ReviewSort = (typeof SORTS)[number];

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isReviewFile = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/.test(v);

/** Plain text only: control characters and markup-looking tags are removed, whitespace is tidied. React escapes output; this keeps stored text clean too. */
export function cleanText(input: string, multiline: boolean): string {
  // eslint-disable-next-line no-control-regex -- intentional: strips control and bidi characters from review text
  let t = input.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  t = t.replace(/<\/?[a-zA-Z!][^>]*>/g, '');
  t = multiline ? t.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ');
  return t.trim();
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ReviewInput {
  rating: number;
  title: string;
  body: string;
}

export function parseRating(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
}

export function parseReviewInput(raw: Record<string, unknown>): Parsed<ReviewInput> {
  const rating = parseRating(raw.rating);
  if (rating === null) return { ok: false, message: 'Choose a rating from 1 to 5 stars.' };
  if (typeof raw.title !== 'string' || typeof raw.body !== 'string') return { ok: false, message: 'Add a title and a written review.' };
  const title = cleanText(raw.title, false);
  const body = cleanText(raw.body, true);
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) return { ok: false, message: `The title needs ${TITLE_MIN} to ${TITLE_MAX} characters.` };
  if (body.length < BODY_MIN || body.length > BODY_MAX) return { ok: false, message: `The review needs ${BODY_MIN} to ${BODY_MAX} characters.` };
  return { ok: true, value: { rating, title, body } };
}

export function parseReply(v: unknown): Parsed<string> {
  if (typeof v !== 'string') return { ok: false, message: 'Write a reply.' };
  const t = cleanText(v, true);
  return t.length < REPLY_MIN || t.length > REPLY_MAX ? { ok: false, message: `A reply needs ${REPLY_MIN} to ${REPLY_MAX} characters.` } : { ok: true, value: t };
}

export function parseReason(v: unknown, required: boolean): Parsed<string | null> {
  const t = typeof v === 'string' ? cleanText(v, false) : '';
  if (required && t.length < 5) return { ok: false, message: 'Give a reason of at least 5 characters.' };
  return t.length > 300 ? { ok: false, message: 'Keep the reason under 300 characters.' } : { ok: true, value: t || null };
}

/**
 * Health-claim safety flags. These only HOLD a review for a person (PENDING); nothing is removed or rewritten automatically, and plain
 * negative feedback ("did not work for me", "stomach upset") is deliberately not matched. Patterns are narrow and documented.
 */
const SAFETY_PATTERNS: ReadonlyArray<{ flag: string; re: RegExp }> = [
  { flag: 'cure_claim', re: /\b(cure[sd]?|cured|cures|completely healed|reversed (my )?(diabetes|pcos|cancer|disease))\b/i },
  { flag: 'stop_medication', re: /\b(stop(ped)?|quit|throw(n)? away|skip(ped)?|without)\b[^.\n]{0,40}\b(medicine|medication|insulin|tablets?|pills?|prescription|treatment)\b/i },
  { flag: 'treatment_advice', re: /\b(you should|must|everyone should|do not|don't)\b[^.\n]{0,30}\b(take|drink|give)\b[^.\n]{0,40}\b(instead of|replace|daily for|dose)\b/i },
  { flag: 'guarantee', re: /\b(guaranteed|100% (cure|safe|effective)|miracle|permanent(ly)? (cure|fix))\b/i },
  { flag: 'personal_medical', re: /\b(my (diagnosis|lab report|blood test|hba1c|biopsy)|diagnosed with)\b/i },
  { flag: 'contact_details', re: /(\b\d{10}\b|\+\d[\d\s-]{8,}|[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/)/i },
];
export const safetyFlags = (text: string): string[] => SAFETY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.flag);
export const SAFETY_FLAG_LABELS: Record<string, string> = {
  cure_claim: 'Cure claim',
  stop_medication: 'Advice about stopping medicine',
  treatment_advice: 'Treatment advice',
  guarantee: 'Guarantee or miracle claim',
  personal_medical: 'Personal medical information',
  contact_details: 'Contact details or link',
};

export const parseSort = (v: unknown): ReviewSort => (typeof v === 'string' && (SORTS as readonly string[]).includes(v) ? (v as ReviewSort) : 'recent');
export const parseStarFilter = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};
export const parsePage = (v: unknown): number => Math.min(500, Math.max(1, Math.floor(Number(v)) || 1));

/** Counts per star always sum to the total; the average is recomputed here only for display checks (the database is the source). */
export function averageFrom(dist: Record<'1' | '2' | '3' | '4' | '5', number>): number | null {
  const total = [1, 2, 3, 4, 5].reduce((s, k) => s + dist[String(k) as '1'], 0);
  if (total === 0) return null;
  return Math.round(([1, 2, 3, 4, 5].reduce((s, k) => s + k * dist[String(k) as '1'], 0) / total) * 100) / 100;
}

// ---- image upload: content checks and metadata stripping (no image library is installed, so this is done on the bytes) ----

/** Removes EXIF/XMP/IPTC/ICC and comments. JPEG: drops APPn (except APP0 JFIF) and COM segments. PNG: keeps only critical chunks. WebP: drops EXIF, XMP and ICCP chunks. */
export function stripImageMetadata(bytes: Uint8Array, kind: 'jpg' | 'png' | 'webp'): Uint8Array | null {
  try {
    if (kind === 'jpg') return stripJpeg(bytes);
    if (kind === 'png') return stripPng(bytes);
    return stripWebp(bytes);
  } catch {
    return null;
  }
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xd9) { out.push(0xff, 0xd9); return Uint8Array.from(out); }
    if (m === 0xda) { // start of scan: the rest is entropy-coded data up to EOI
      for (let k = i; k < b.length; k++) out.push(b[k]);
      return out.length > 4 && out[out.length - 2] === 0xff && out[out.length - 1] === 0xd9 ? Uint8Array.from(out) : null;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(0xff, m); i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    const keep = !((m >= 0xe1 && m <= 0xef) || m === 0xfe);
    if (keep) for (let k = i; k < i + 2 + len; k++) out.push(b[k]);
    i += 2 + len;
  }
  return null;
}

function stripPng(b: Uint8Array): Uint8Array | null {
  const out: number[] = Array.from(b.slice(0, 8));
  const keep = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB']);
  let i = 8;
  let sawEnd = false;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (i + 12 + len > b.length) return null;
    if (keep.has(type)) for (let k = i; k < i + 12 + len; k++) out.push(b[k]);
    i += 12 + len;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  return sawEnd ? Uint8Array.from(out) : null;
}

function stripWebp(b: Uint8Array): Uint8Array | null {
  const drop = new Set(['EXIF', 'XMP ', 'ICCP']);
  const body: number[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    const end = i + 8 + len + (len & 1);
    if (end > b.length + 1) return null;
    if (!drop.has(type)) for (let k = i; k < Math.min(end, b.length); k++) body.push(b[k]);
    i = end;
  }
  const size = 4 + body.length;
  const head = [0x52, 0x49, 0x46, 0x46, size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, 0x57, 0x45, 0x42, 0x50];
  return Uint8Array.from([...head, ...body]);
}

/** Validates size and content, strips metadata. The client-sent type and file name are never used. */
export function prepareReviewImage(bytes: Uint8Array): Parsed<{ kind: 'jpg' | 'png' | 'webp'; bytes: Uint8Array }> {
  if (bytes.length === 0 || bytes.length > MAX_REVIEW_IMAGE_BYTES) return { ok: false, message: 'Each photo must be under 2 MB.' };
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, message: 'Use a JPEG, PNG or WebP photo.' };
  const clean = stripImageMetadata(bytes, kind);
  if (!clean || clean.length === 0) return { ok: false, message: 'That photo could not be read. Try another file.' };
  return { ok: true, value: { kind, bytes: clean } };
}
