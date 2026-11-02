import { parsePage as parseAdminPage } from '../../shared/admin.js';
import { MODERATION_ACTIONS, REPORT_REASONS, isReviewFile, isUuid, parseReason, parseReply, parseStarFilter, REVIEW_STATUSES, type ModerationAction } from '../../shared/reviews.js';
import { readReviewImage, reviewMime, reviewRpc, type ReviewRpc } from '../reviews.js';
import { rest } from '../supabase.js';
import { PAGE_SIZE, bodyOf, need, pageRange, totalOf, type AdminCtx } from './ctx.js';

const COLUMNS = 'id,product_id,rating,title,body,status,status_reason,safety_flags,edit_count,created_at,updated_at,products(slug,public_name,internal_name),members(name),review_replies(body,author,created_at,updated_at),review_images(id,file,status),review_reports(id,status)';

function failWith(ctx: AdminCtx, r: Extract<ReviewRpc<unknown>, { ok: false }>) {
  const status = r.kind === 'not_found' ? 404 : r.kind === 'invalid' ? 400 : r.kind === 'unknown' ? 502 : 409;
  return ctx.json(status, { status: r.kind === 'invalid' ? 'invalid' : 'error', message: r.message });
}

/**
 * Review moderation (admin). Reading needs reviews.read, hiding/approving/rejecting/restoring and handling reports and photos needs
 * reviews.moderate, brand replies need reviews.reply. There is deliberately NO action that edits a customer's stars, title or text,
 * and no delete: the database functions it calls only change status. Every action is audited twice (admin_audit and the append-only
 * review_moderation_events). Returns true when it handled the action.
 */
export async function handleReviews(ctx: AdminCtx, action: string): Promise<boolean> {
  const { req, cfg, json, audit } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;
  if (!action.startsWith('review')) return false;

  if (action === 'reviews' && method === 'GET') {
    if (!(await need(ctx, 'reviews.read'))) return true;
    const page = parseAdminPage(req.query.page);
    const st = String(req.query.status ?? '');
    const star = parseStarFilter(req.query.rating);
    const product = String(req.query.product ?? '');
    let filter = '';
    if ((REVIEW_STATUSES as readonly string[]).includes(st)) filter += `&status=eq.${st}`;
    if (star) filter += `&rating=eq.${star}`;
    if (isUuid(product)) filter += `&product_id=eq.${product}`;
    if (req.query.flagged === '1') filter += '&safety_flags=not.eq.%7B%7D';
    const r = await rest(db, `product_reviews?select=${COLUMNS}&order=created_at.desc&${pageRange(page)}${filter}`, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(`reviews ${r.status}`);
    // Only the customer's first name is returned to the dashboard: no email, phone, address or order data.
    const items = ((await r.json()) as Record<string, unknown>[]).map((row) => {
      const { members, ...rest2 } = row as { members?: { name?: string | null } | null } & Record<string, unknown>;
      return { ...rest2, customer: (members?.name ?? '').trim().split(' ')[0]?.slice(0, 30) || 'Customer' };
    });
    json(200, { status: 'ok', items, total: totalOf(r), page, pageSize: PAGE_SIZE });
    return true;
  }

  if (action === 'review-moderate' && method === 'POST') {
    if (!(await need(ctx, 'reviews.moderate'))) return true;
    const body = bodyOf(req);
    const act = body.action as ModerationAction;
    if (!isUuid(body.review) || !(MODERATION_ACTIONS as readonly string[]).includes(act)) return json(400, { status: 'invalid', message: 'Invalid request.' }), true;
    const reason = parseReason(body.reason, act === 'hide' || act === 'reject');
    if (!reason.ok) return json(400, { status: 'invalid', message: reason.message }), true;
    const r = await reviewRpc<{ id: string; status: string }>(db, 'review_moderate', { p_review: body.review, p_action: act, p_actor: ctx.email, p_reason: reason.value });
    if (!r.ok) return failWith(ctx, r), true;
    await audit('review_moderated', { review: body.review, action: act, to: r.data.status });
    json(200, { status: 'ok', reviewStatus: r.data.status });
    return true;
  }

  if (action === 'review-reply' && method === 'POST') {
    if (!(await need(ctx, 'reviews.reply'))) return true;
    const body = bodyOf(req);
    const text = parseReply(body.body);
    if (!isUuid(body.review) || !text.ok) return json(400, { status: 'invalid', message: text.ok ? 'Invalid request.' : text.message }), true;
    const r = await reviewRpc<{ edited: boolean }>(db, 'review_reply_set', { p_review: body.review, p_actor: ctx.email, p_body: text.value });
    if (!r.ok) return failWith(ctx, r), true;
    await audit(r.data.edited ? 'review_reply_edited' : 'review_replied', { review: body.review });
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'review-image-decide' && method === 'POST') {
    if (!(await need(ctx, 'reviews.moderate'))) return true;
    const body = bodyOf(req);
    if (!isUuid(body.image) || typeof body.approve !== 'boolean') return json(400, { status: 'invalid', message: 'Invalid request.' }), true;
    const r = await reviewRpc<{ review: string }>(db, 'review_image_decide', { p_image: body.image, p_actor: ctx.email, p_approve: body.approve });
    if (!r.ok) return failWith(ctx, r), true;
    await audit(body.approve ? 'review_image_approved' : 'review_image_rejected', { image: body.image, review: r.data.review });
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'review-reports' && method === 'GET') {
    if (!(await need(ctx, 'reviews.read'))) return true;
    const page = parseAdminPage(req.query.page);
    const st = String(req.query.status ?? 'OPEN');
    const filter = ['OPEN', 'DISMISSED', 'ACTIONED'].includes(st) ? `&status=eq.${st}` : '';
    const r = await rest(db, `review_reports?select=id,review_id,reason,note,status,handled_by,handled_at,created_at,product_reviews(rating,title,body,status)&order=created_at.desc&${pageRange(page)}${filter}`, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(`review reports ${r.status}`);
    json(200, { status: 'ok', items: await r.json(), total: totalOf(r), page, pageSize: PAGE_SIZE, reasons: REPORT_REASONS });
    return true;
  }

  if (action === 'review-report-handle' && method === 'POST') {
    if (!(await need(ctx, 'reviews.moderate'))) return true;
    const body = bodyOf(req);
    if (!isUuid(body.report) || !['DISMISSED', 'ACTIONED'].includes(String(body.outcome))) return json(400, { status: 'invalid', message: 'Invalid request.' }), true;
    const r = await reviewRpc<unknown>(db, 'review_report_handle', { p_report: body.report, p_actor: ctx.email, p_outcome: body.outcome });
    if (!r.ok) return failWith(ctx, r), true;
    await audit('review_report_handled', { report: body.report, outcome: body.outcome });
    json(200, { status: 'ok' });
    return true;
  }

  if (action === 'review-events' && method === 'GET') {
    if (!(await need(ctx, 'reviews.read'))) return true;
    if (!isUuid(req.query.review)) return json(400, { status: 'invalid', message: 'Invalid review.' }), true;
    const r = await rest(db, `review_moderation_events?select=id,actor,action,from_status,to_status,reason,created_at&review_id=eq.${req.query.review}&order=created_at.desc&limit=100`);
    if (!r.ok) throw new Error(`review events ${r.status}`);
    json(200, { status: 'ok', items: await r.json() });
    return true;
  }

  if (action === 'review-analytics' && method === 'GET') {
    if (!(await need(ctx, 'reviews.read'))) return true;
    const days = Math.min(365, Math.max(1, Math.floor(Number(req.query.days)) || 30));
    const r = await reviewRpc<unknown>(db, 'review_analytics', { p_days: days });
    if (!r.ok) return failWith(ctx, r), true;
    json(200, { status: 'ok', days, ...(r.data as Record<string, unknown>) });
    return true;
  }

  if (action === 'review-image' && method === 'GET') {
    if (!(await need(ctx, 'reviews.read'))) return true;
    const file = String(req.query.file ?? '');
    const bytes = isReviewFile(file) ? await readReviewImage(db, file) : null;
    if (!bytes) return json(404, { status: 'error', message: 'Not found.' }), true;
    ctx.res.setHeader('Content-Type', reviewMime(file));
    ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
    ctx.res.setHeader('Content-Security-Policy', "default-src 'none'");
    ctx.res.setHeader('Cache-Control', 'private, max-age=300');
    ctx.res.status(200).send(bytes);
    return true;
  }
  return false;
}
