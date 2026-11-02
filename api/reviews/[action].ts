import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, createLimiter, isLimited, limitDecision, originAllowed } from '../../server/http.js';
import { currentMember, deleteReviewImage, publicProductId, readReviewImage, reviewMime, reviewRpc, storeReviewImage, type ReviewRpc } from '../../server/reviews.js';
import { rest, supabaseConfig, type SupabaseConfig } from '../../server/supabase.js';
import {
  MAX_REVIEW_IMAGES, PUBLIC_PAGE_SIZE, REPORT_REASONS, isReviewFile, isUuid, parsePage, parseReviewInput, parseSort, parseStarFilter, prepareReviewImage, safetyFlags,
  type ReportReason,
} from '../../shared/reviews.js';

/**
 * Customer reviews API (one function, to stay inside the 12-function Vercel Hobby limit).
 *   GET  list     public: stats + a bounded page of PUBLISHED reviews for a publicly approved product (first name only, no private data)
 *   GET  mine     signed in: eligibility for a product and the caller's own review
 *   GET  image    public: an APPROVED photo of a PUBLISHED review, nothing else
 *   POST submit | update | withdraw | report | upload-image   signed in, same-origin, CSRF header, rate limited
 * The customer is identified only by the signed cookie. Ownership, delivery, payment and the verified flag are decided in the database.
 */
const MIN = 60 * 1000;
const readLimiter = createLimiter(MIN, 120, 'review_read');
const writeLimiter = createLimiter(60 * MIN, 12, 'review_write', 'closed');
const reportLimiter = createLimiter(60 * MIN, 20, 'review_report', 'closed');
const uploadLimiter = createLimiter(60 * MIN, 15, 'review_upload', 'closed');
const imageLimiter = createLimiter(MIN, 240);
const MAX_B64 = Math.ceil((2_000_000 * 4) / 3) + 8;

const fail = (res: VercelResponse, r: Extract<ReviewRpc<unknown>, { ok: false }>) => {
  const status = r.kind === 'not_found' ? 404 : r.kind === 'not_eligible' ? 403 : r.kind === 'limit' ? 429 : r.kind === 'unknown' ? 502 : r.kind === 'invalid' ? 400 : 409;
  return res.status(status).json({ status: r.kind === 'invalid' ? 'invalid' : 'error', message: r.message });
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action ?? '');
  const method = req.method ?? 'GET';
  const GET = ['list', 'mine', 'image'];
  const POST = ['submit', 'update', 'withdraw', 'report', 'upload-image'];
  if (!GET.includes(action) && !POST.includes(action)) return res.status(404).json({ status: 'error', message: 'Not found.' });
  if ((GET.includes(action) && method !== 'GET') || (POST.includes(action) && method !== 'POST')) return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
  const db = supabaseConfig();
  if (!db) return res.status(503).json({ status: 'error', message: 'Reviews are unavailable right now.' });

  try {
    if (action === 'image') return await serveImage(req, res, db);
    res.setHeader('Cache-Control', action === 'list' ? 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' : 'no-store');
    if (action === 'list') {
      if (await isLimited(readLimiter, clientIp(req))) return res.status(429).json({ status: 'error', message: 'Too many requests. Try again shortly.' });
      const pid = await publicProductId(db, String(req.query.product ?? ''));
      if (!pid) return res.status(404).json({ status: 'error', message: 'Not found.' });
      const page = parsePage(req.query.page);
      const [stats, list] = await Promise.all([
        reviewRpc<unknown>(db, 'review_stats', { p_product: pid }),
        reviewRpc<{ items: unknown[] }>(db, 'review_public_list', { p_product: pid, p_rating: parseStarFilter(req.query.rating), p_sort: parseSort(req.query.sort), p_limit: PUBLIC_PAGE_SIZE, p_offset: (page - 1) * PUBLIC_PAGE_SIZE }),
      ]);
      if (!stats.ok || !list.ok) return res.status(502).json({ status: 'error', message: 'Reviews could not be loaded.' });
      return res.status(200).json({ status: 'ok', stats: stats.data, items: list.data.items, page, pageSize: PUBLIC_PAGE_SIZE });
    }

    // Everything below needs a signed-in customer.
    const member = await currentMember(req, db);
    if (!member) return res.status(401).json({ status: 'error', message: 'Please sign in.' });

    if (action === 'mine') {
      if (await isLimited(readLimiter, member.id)) return res.status(429).json({ status: 'error', message: 'Too many requests. Try again shortly.' });
      const pid = await publicProductId(db, String(req.query.product ?? ''));
      if (!pid) return res.status(404).json({ status: 'error', message: 'Not found.' });
      const [elig, own] = await Promise.all([
        reviewRpc<{ order_item_id: string }[]>(db, 'review_eligible_items', { p_member: member.id, p_product: pid }),
        rest(db, `product_reviews?select=id,rating,title,body,status,status_reason,edit_count,created_at,updated_at,review_images(id,file,status)&member_id=eq.${member.id}&product_id=eq.${pid}&limit=1`),
      ]);
      if (!elig.ok || !own.ok) return res.status(502).json({ status: 'error', message: 'Could not check your eligibility.' });
      const review = ((await own.json()) as unknown[])[0] ?? null;
      return res.status(200).json({ status: 'ok', eligible: elig.data.length > 0 && review === null, review });
    }

    if (!(originAllowed(req) && req.headers['x-kaayra-csrf'] === '1')) return res.status(403).json({ status: 'error', message: 'Request not allowed.' });
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const limiter = action === 'report' ? reportLimiter : action === 'upload-image' ? uploadLimiter : writeLimiter;
    const decision = await limitDecision(limiter, member.id);
    if (decision === 'limited') return res.status(429).json({ status: 'error', message: 'Too many attempts. Please wait a while.' });
    if (decision === 'unavailable') return res.status(503).json({ status: 'error', message: 'Please try again shortly.' });

    if (action === 'submit' || action === 'update') {
      const parsed = parseReviewInput(body);
      if (!parsed.ok) return res.status(400).json({ status: 'invalid', message: parsed.message });
      const flags = safetyFlags(`${parsed.value.title}\n${parsed.value.body}`);
      if (action === 'submit') {
        const pid = await publicProductId(db, typeof body.product === 'string' ? body.product : '');
        if (!pid) return res.status(404).json({ status: 'error', message: 'Not found.' });
        const r = await reviewRpc<{ id: string; status: string }>(db, 'review_submit', { p_member: member.id, p_product: pid, p_rating: parsed.value.rating, p_title: parsed.value.title, p_body: parsed.value.body, p_flags: flags, p_has_images: false });
        return r.ok ? res.status(201).json({ status: 'ok', id: r.data.id, reviewStatus: r.data.status, held: r.data.status === 'PENDING' }) : fail(res, r);
      }
      if (!isUuid(body.review)) return res.status(400).json({ status: 'invalid', message: 'Invalid review.' });
      const r = await reviewRpc<{ id: string; status: string }>(db, 'review_update_own', { p_member: member.id, p_review: body.review, p_rating: parsed.value.rating, p_title: parsed.value.title, p_body: parsed.value.body, p_flags: flags });
      return r.ok ? res.status(200).json({ status: 'ok', id: r.data.id, reviewStatus: r.data.status, held: r.data.status === 'PENDING' }) : fail(res, r);
    }

    if (action === 'withdraw') {
      if (!isUuid(body.review)) return res.status(400).json({ status: 'invalid', message: 'Invalid review.' });
      const r = await reviewRpc<{ id: string }>(db, 'review_withdraw_own', { p_member: member.id, p_review: body.review });
      return r.ok ? res.status(200).json({ status: 'ok' }) : fail(res, r);
    }

    if (action === 'report') {
      if (!isUuid(body.review) || typeof body.reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(body.reason)) return res.status(400).json({ status: 'invalid', message: 'Choose a reason for the report.' });
      const note = typeof body.note === 'string' ? body.note.slice(0, 300) : '';
      const r = await reviewRpc<unknown>(db, 'review_report_add', { p_review: body.review, p_reporter: member.id, p_reason: body.reason as ReportReason, p_note: note });
      // Same answer for a new and a repeated report, so reports cannot be used to probe.
      return r.ok ? res.status(200).json({ status: 'ok', message: 'Thank you. Our team will look at this review.' }) : fail(res, r);
    }

    // upload-image: own review only, at most 3 photos, content checked and metadata removed before storing
    if (!isUuid(body.review)) return res.status(400).json({ status: 'invalid', message: 'Invalid review.' });
    const own = await rest(db, `product_reviews?select=id,status,review_images(id)&id=eq.${body.review}&member_id=eq.${member.id}&limit=1`);
    if (!own.ok) throw new Error(`review lookup ${own.status}`);
    const row = ((await own.json()) as { status: string; review_images: unknown[] }[])[0];
    if (!row) return res.status(404).json({ status: 'error', message: 'That review was not found.' });
    if (!['PUBLISHED', 'PENDING', 'HIDDEN'].includes(row.status)) return res.status(409).json({ status: 'error', message: 'Photos can no longer be added to this review.' });
    if (row.review_images.length >= MAX_REVIEW_IMAGES) return res.status(409).json({ status: 'error', message: `A review can have up to ${MAX_REVIEW_IMAGES} photos.` });
    const b64 = typeof body.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : '';
    if (!b64 || b64.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return res.status(400).json({ status: 'invalid', message: 'The photo is missing, invalid or larger than 2 MB.' });
    const img = prepareReviewImage(Buffer.from(b64, 'base64'));
    if (!img.ok) return res.status(400).json({ status: 'invalid', message: img.message });
    const file = await storeReviewImage(db, img.value.kind, img.value.bytes);
    const ins = await rest(db, 'review_images', { method: 'POST', body: JSON.stringify({ review_id: body.review, file, bytes: img.value.bytes.length }) });
    if (!ins.ok) {
      await deleteReviewImage(db, file);
      throw new Error(`review image insert ${ins.status}`);
    }
    return res.status(201).json({ status: 'ok', message: 'Photo received. It appears after our team approves it.' });
  } catch (e) {
    console.error('reviews error', action, e instanceof Error ? e.message : 'unknown');
    return res.status(502).json({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
}

/** A photo is served only while it is APPROVED and its review is PUBLISHED; the storage bucket itself is private. */
async function serveImage(req: VercelRequest, res: VercelResponse, db: SupabaseConfig) {
  if (imageLimiter(clientIp(req))) return res.status(429).end();
  const file = typeof req.query.file === 'string' ? req.query.file : '';
  if (!isReviewFile(file)) return res.status(404).end();
  const ref = await rest(db, `review_images?select=id,product_reviews!inner(status)&file=eq.${file}&status=eq.APPROVED&product_reviews.status=eq.PUBLISHED&limit=1`);
  if (!ref.ok || ((await ref.json()) as unknown[]).length === 0) return res.status(404).end();
  const bytes = await readReviewImage(db, file);
  if (!bytes) return res.status(404).end();
  res.setHeader('Content-Type', reviewMime(file));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.status(200).send(bytes);
}
