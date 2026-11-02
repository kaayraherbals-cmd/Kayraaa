import { randomUUID } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { isReviewFile } from '../shared/reviews.js';
import { findMemberByEmail } from './members.js';
import { USER_COOKIE, verifyToken } from './oauth.js';
import { MIN_SECRET_LENGTH } from './session.js';
import { rest, type SupabaseConfig } from './supabase.js';

export const REVIEW_BUCKET = 'review-images';
const MIME = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' } as const;
export const reviewMime = (file: string): string => MIME[(file.split('.').pop() ?? '') as keyof typeof MIME] ?? 'application/octet-stream';

export type ReviewFailureKind = 'not_found' | 'not_eligible' | 'state' | 'invalid' | 'limit' | 'unknown';
export type ReviewRpc<T> = { ok: true; data: T } | { ok: false; kind: ReviewFailureKind; message: string };

const FRIENDLY: Record<string, { kind: ReviewFailureKind; message?: string }> = {
  NOT_FOUND: { kind: 'not_found', message: 'That review was not found.' },
  NOT_ELIGIBLE: { kind: 'not_eligible', message: 'Only a delivered, paid order of this product can be reviewed, once per product.' },
  STATE: { kind: 'state' },
  INVALID: { kind: 'invalid' },
  LIMIT: { kind: 'limit', message: 'Too many reports today. Please try again tomorrow.' },
};

/** Calls a review database function. Only our own "KH:" messages are ever shown; anything else is logged by code only. */
export async function reviewRpc<T>(db: SupabaseConfig, fn: string, args: Record<string, unknown>): Promise<ReviewRpc<T>> {
  const r = await rest(db, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  const body = (await r.json().catch(() => null)) as { message?: unknown; code?: unknown } | null;
  if (r.ok) return { ok: true, data: body as T };
  if (body?.code === '23505') return { ok: false, kind: 'state', message: 'You have already reviewed this product.' };
  const m = typeof body?.message === 'string' ? /^KH:([A-Z_]+):?(.*)$/.exec(body.message) : null;
  const f = m ? FRIENDLY[m[1]] : undefined;
  if (!m || !f) {
    console.error(`review rpc ${fn} failed`, r.status, typeof body?.code === 'string' ? body.code.slice(0, 10) : '');
    return { ok: false, kind: 'unknown', message: 'Something went wrong. Please try again.' };
  }
  return { ok: false, kind: f.kind, message: f.message ?? (m[2].trim() || 'That is not possible right now.') };
}

/** The signed-in customer from the signed cookie. Never from the request body. */
export async function currentMember(req: VercelRequest, db: SupabaseConfig): Promise<{ id: string } | null> {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const raw = verifyToken<{ email: string }>('user', req.cookies?.[USER_COOKIE], secret);
  if (!raw || typeof raw.email !== 'string') return null;
  const m = await findMemberByEmail(db, raw.email);
  return m ? { id: m.id } : null;
}

/** A product id, only for products that are publicly approved (the public_products view), so drafts cannot be reviewed or probed. */
export async function publicProductId(db: SupabaseConfig, slug: string): Promise<string | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 90) return null;
  const pub = await rest(db, `public_products?select=slug&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  if (!pub.ok || ((await pub.json()) as unknown[]).length === 0) return null;
  const p = await rest(db, `products?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  if (!p.ok) return null;
  return ((await p.json()) as { id: string }[])[0]?.id ?? null;
}

const h = (db: SupabaseConfig, extra: Record<string, string> = {}) => ({ apikey: db.serviceKey, Authorization: `Bearer ${db.serviceKey}`, ...extra });

/** Stores already-validated, metadata-stripped bytes under a random name in the PRIVATE review bucket. */
export async function storeReviewImage(db: SupabaseConfig, kind: keyof typeof MIME, bytes: Uint8Array): Promise<string> {
  const file = `${randomUUID()}.${kind}`;
  const r = await fetch(`${db.url}/storage/v1/object/${REVIEW_BUCKET}/${file}`, { method: 'POST', headers: h(db, { 'Content-Type': MIME[kind], 'x-upsert': 'false' }), body: new Uint8Array(bytes) });
  if (!r.ok) throw new Error(`review storage upload ${r.status}`);
  return file;
}

export async function readReviewImage(db: SupabaseConfig, file: string): Promise<Buffer | null> {
  if (!isReviewFile(file)) return null;
  const r = await fetch(`${db.url}/storage/v1/object/${REVIEW_BUCKET}/${file}`, { headers: h(db) });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}

/** Best effort cleanup of a stored file (for example when the database insert failed after the upload). */
export async function deleteReviewImage(db: SupabaseConfig, file: string): Promise<void> {
  if (!isReviewFile(file)) return;
  try {
    await fetch(`${db.url}/storage/v1/object/${REVIEW_BUCKET}/${file}`, { method: 'DELETE', headers: h(db) });
  } catch {
    /* ignore */
  }
}
