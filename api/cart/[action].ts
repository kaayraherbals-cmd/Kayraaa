import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkoutOpen } from '../../shared/checkout.js';
import { CART_MAX_QTY, evaluateLine, isUuid, parseLines, priceCart, type CartLineInput } from '../../shared/cart.js';
import { publicFlags, readFlags, type Flags } from '../../shared/flags.js';
import { applyCoupon, priceWithSavedCoupon, removeCoupon } from '../../server/coupons.js';
import { couponMessage } from '../../shared/coupons.js';
import { clearSavedCart, getSavedCart, loadVariantRecords, mergeSavedCart, setSavedItem, variantIdsForSlug } from '../../server/cart.js';
import { sendError } from '../../server/errors.js';
import { clientIp, createLimiter, originAllowed } from '../../server/http.js';
import { findMemberByEmail } from '../../server/members.js';
import { USER_COOKIE, verifyToken } from '../../server/oauth.js';
import { getMarketingState, loadSettings, redeemRestoreToken, setCartReminders, unsubscribeFromEmail } from '../../server/recovery.js';
import { verifyUnsubscribeToken } from '../../server/recoveryToken.js';
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, type RedeemResult } from '../../shared/recovery.js';
import { MIN_SECRET_LENGTH } from '../../server/session.js';
import { supabaseConfig, type SupabaseConfig } from '../../server/supabase.js';
import { toPublicBundles } from '../../shared/bundleView.js';
import { rpc } from '../../server/rpc.js';
import { productIdForSlug, wishlistAdd, wishlistFor, wishlistRemove, wishlistTrackToCart } from '../../server/wishlist.js';

/**
 * Shopping bag API (development preview). Everything except `config` is closed (404) unless FEATURE_CART_PREVIEW is on, and the
 * flag cannot be on in production (shared/flags.ts). Even then nothing can be bought: checkout is gated by COMMERCE_ENABLED.
 *
 * The browser sends variant ids and quantities only. Prices, tax, names and stock are read from the database on every
 * request and returned; any price the browser might send is ignored by parseLines.
 */
const MIN = 60 * 1000;
const readLimiter = createLimiter(MIN, 120);
const writeLimiter = createLimiter(MIN, 60);
// Putting a code on a bag is rate-limited per address here, and per member inside the database (10 failed tries in 15 minutes).
const couponLimiter = createLimiter(MIN, 12);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Public cart-recovery endpoints (restore link, unsubscribe) get their own, tighter limit per IP. */
const recoveryLimiter = createLimiter(MIN, 20);

/** What the customer is told for each restore-link outcome. None of them reveals anything about a bag, an order or another account. */
const RECOVER_TEXT: Record<Exclude<RedeemResult, 'ok'>, string> = {
  invalid: 'This link is not valid. Your saved bag is below, if you are signed in.',
  closed: 'This reminder link is no longer active. Your saved bag is below, if you are signed in.',
  expired: 'This reminder link has expired. Your saved bag is below, if you are signed in.',
  signin_required: 'Please sign in to continue to your bag.',
  wrong_account: 'This link is for a different account. Please sign in with the account you use for Kaayra Herbals.',
};
const RECOVER_STATUS: Record<Exclude<RedeemResult, 'ok'>, number> = { invalid: 404, closed: 410, expired: 410, signin_required: 401, wrong_account: 403 };

function body(req: VercelRequest): Record<string, unknown> {
  const b = req.body as unknown;
  if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  if (typeof b === 'string') {
    try {
      const p = JSON.parse(b) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}

/** The signed-in customer, re-checked against the members table on every request (as the auth API does). */
async function currentMember(req: VercelRequest, db: SupabaseConfig): Promise<{ id: string; email: string } | null> {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const raw = verifyToken<{ email: string; name: string | null; role: string }>('user', req.cookies?.[USER_COOKIE], secret);
  if (!raw || typeof raw.email !== 'string') return null;
  const m = await findMemberByEmail(db, raw.email);
  return m ? { id: m.id, email: m.email } : null;
}

const view = (lines: CartLineInput[], records: Awaited<ReturnType<typeof loadVariantRecords>>, flags: Flags) => {
  const { lines: priced, totals } = priceCart(lines, records);
  return { status: 'ok', lines: priced, totals, checkoutOpen: checkoutOpen(flags), currency: 'INR', pricesIncludeGst: true };
};

/**
 * The signed-in customer's bag with its coupon: the code saved on the bag is re-checked against the live lines on every read, so a
 * coupon that has expired or no longer qualifies shows its reason and gives no discount. The cart shows items only; shipping and
 * the final total are worked out at checkout.
 */
async function signedView(db: SupabaseConfig, memberId: string, lines: CartLineInput[], records: Awaited<ReturnType<typeof loadVariantRecords>>, flags: Flags) {
  const base = view(lines, records, flags);
  const pc = await priceWithSavedCoupon(db, memberId, base.lines, records, 0, base.totals.gstIncludedPaise);
  return { ...base, coupon: pc.applied, totals: { ...base.totals, discountPaise: pc.discountPaise, afterDiscountPaise: base.totals.subtotalPaise - pc.discountPaise, gstIncludedPaise: pc.gstIncludedPaise } };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const action = String(req.query.action ?? '');
  const method = req.method ?? 'GET';
  const flags = readFlags(process.env);

  if (action === 'config' && method === 'GET') return res.status(200).json({ status: 'ok', ...publicFlags(flags) });
  if (!flags.cart_preview) return sendError(res, 'CART', 'KH-CART-001');

  const ip = clientIp(req);
  if (method === 'GET' ? readLimiter(ip) : writeLimiter(ip)) return sendError(res, 'CART', 'KH-CART-005');
  // One-click unsubscribe from a mail client (RFC 8058). The signed token is the credential, so no origin or CSRF header is expected.
  if (action === 'unsubscribe' && method === 'POST' && typeof req.query.u === 'string') {
    if (recoveryLimiter(ip)) return sendError(res, 'CART', 'KH-CART-005');
    const secret = process.env.SUBSCRIBE_TOKEN_SECRET?.trim() ?? '';
    const memberId = secret.length >= 32 ? verifyUnsubscribeToken(req.query.u, secret) : null;
    const udb = supabaseConfig();
    if (!memberId || !udb) return res.status(400).json({ status: 'invalid_link', message: 'This link is not valid.' });
    try {
      await unsubscribeFromEmail(udb, memberId);
      return res.status(200).json({ status: 'unsubscribed' });
    } catch (e) {
      console.error('cart unsubscribe failed', e instanceof Error ? e.name : 'error');
      return sendError(res, 'CART', 'KH-CART-006');
    }
  }

  if (method !== 'GET' && !(originAllowed(req) && req.headers['x-kaayra-csrf'] === '1')) return res.status(403).json({ status: 'error', message: 'Request not allowed.' });

  const db = supabaseConfig();
  if (!db) return sendError(res, 'CART', 'KH-CART-001');

  try {
    // ---- unsubscribe from the /subscription page (the person pressed the button) -------------------
    if (action === 'unsubscribe' && method === 'POST') {
      if (recoveryLimiter(ip)) return sendError(res, 'CART', 'KH-CART-005');
      const secret = process.env.SUBSCRIBE_TOKEN_SECRET?.trim() ?? '';
      const memberId = secret.length >= 32 ? verifyUnsubscribeToken(body(req).token, secret) : null;
      if (!memberId) return res.status(400).json({ status: 'invalid_link', message: 'This link is not valid.' });
      await unsubscribeFromEmail(db, memberId);
      return res.status(200).json({ status: 'unsubscribed' });
    }

    // ---- restore link from a reminder email ---------------------------------------------------------
    // Needs the signed-in owner of the bag. A click is only counted for that person. The bag is not copied or rebuilt: it is the
    // customer's own saved bag, returned re-priced from live data WITH its coupon re-checked (signedView), so a recovered bag can
    // never carry an old price, old stock, or a coupon that has expired or stopped qualifying.
    if (action === 'recover' && method === 'POST') {
      if (recoveryLimiter(ip)) return sendError(res, 'CART', 'KH-CART-005');
      const who = await currentMember(req, db);
      const result = await redeemRestoreToken(db, body(req).token, who?.id ?? null);
      if (result === 'ok' && who) {
        const saved = await getSavedCart(db, who.id);
        const records = await loadVariantRecords(db, saved.map((l) => l.variantId));
        return res.status(200).json({ ...(await signedView(db, who.id, saved, records, flags)), recover: 'ok' });
      }
      const outcome: Exclude<RedeemResult, 'ok'> = result === 'ok' ? 'invalid' : result;
      return res.status(RECOVER_STATUS[outcome]).json({ status: outcome, message: RECOVER_TEXT[outcome] });
    }

    // ---- pack-size options for one product ---------------------------------------------------------
    if (action === 'variants' && method === 'GET') {
      const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
      if (!SLUG_RE.test(slug) || slug.length > 90) return sendError(res, 'CART', 'KH-CART-003');
      const ids = await variantIdsForSlug(db, slug);
      const records = await loadVariantRecords(db, ids);
      const options = ids.map((id) => {
        const l = evaluateLine({ variantId: id, qty: 1 }, records.get(id));
        return { variantId: id, packSize: l.packSize, productName: l.productName, unitPaise: l.state === 'unavailable' ? null : l.unitPaise, available: l.state !== 'unavailable', maxQty: l.maxQty, message: l.message };
      });
      return res.status(200).json({ status: 'ok', options, maxPerLine: CART_MAX_QTY });
    }

    // ---- active bundles (public, read-only): live price, real saving, availability. Ordering a bundle is not open yet. -----------
    if (action === 'bundles' && method === 'GET') {
      const r = await rpc<unknown>(db, 'bundle_public_list', { p_limit: 20, p_offset: 0 });
      if (!r.ok) return sendError(res, 'CART', 'KH-CART-006');
      return res.status(200).json({ status: 'ok', bundles: toPublicBundles(r.data), orderable: false });
    }

    // ---- price any list of lines (guests, and signed-in customers re-checking) ---------------------
    if (action === 'validate' && method === 'POST') {
      const parsed = parseLines(body(req).lines);
      if (!parsed.ok) return sendError(res, 'CART', 'KH-CART-003', { errors: parsed.errors });
      const records = await loadVariantRecords(db, parsed.lines.map((l) => l.variantId));
      return res.status(200).json(view(parsed.lines, records, flags));
    }

    // ---- everything below is for the signed-in customer's own saved bag ----------------------------
    const member = await currentMember(req, db);
    if (!member) return sendError(res, 'CART', 'KH-CART-002');

    // ---- reminder-email preference (the customer's own, explicit choice) ----------------------------
    if (action === 'prefs' && method === 'GET') {
      const [st, settings] = await Promise.all([getMarketingState(db, member.id), loadSettings(db)]);
      return res.status(200).json({ status: 'ok', available: settings.enabled, cartReminders: st.cartReminders, consentText: CONSENT_TEXT, consentVersion: CONSENT_TEXT_VERSION });
    }
    if (action === 'prefs' && method === 'POST') {
      if (typeof body(req).cartReminders !== 'boolean') return sendError(res, 'CART', 'KH-CART-003');
      const on = body(req).cartReminders === true;
      const r = await setCartReminders(db, member.id, member.email, on);
      if (r === 'suppressed') return res.status(409).json({ status: 'suppressed', cartReminders: false, message: 'We are not able to email this address. Please contact us if you think this is a mistake.' });
      return res.status(200).json({ status: 'ok', cartReminders: on });
    }

    if (action === 'view' && method === 'GET') {
      const saved = await getSavedCart(db, member.id);
      const records = await loadVariantRecords(db, saved.map((l) => l.variantId));
      return res.status(200).json(await signedView(db, member.id, saved, records, flags));
    }

    // ---- wishlist (the signed-in customer's own list; the member id never comes from the request) -----------------------------
    // Lives in this function because the project is at the serverless-function limit. The slug is the only handle the browser uses.
    if (action === 'wishlist' && method === 'GET') {
      const w = await wishlistFor(db, member.id);
      if (!w.ok) return sendError(res, 'CART', 'KH-CART-006');
      return res.status(200).json({ status: 'ok', items: w.items, count: w.items.length });
    }
    if ((action === 'wishlist-add' || action === 'wishlist-remove') && method === 'POST') {
      const slug = body(req).slug;
      if (typeof slug !== 'string' || slug.length > 90 || !SLUG_RE.test(slug)) return sendError(res, 'CART', 'KH-CART-003', { errors: ['That product could not be found.'] });
      const add = action === 'wishlist-add';
      const productId = await productIdForSlug(db, slug, add);
      if (!productId) return sendError(res, 'CART', 'KH-CART-003', { errors: ['That product is not available to save.'] });
      const r = add ? await wishlistAdd(db, member.id, productId) : await wishlistRemove(db, member.id, productId);
      if (!r.ok) return r.failure.message.includes('full') ? sendError(res, 'CART', 'KH-CART-004', { message: r.failure.message }) : sendError(res, 'CART', 'KH-CART-006');
      const w = await wishlistFor(db, member.id);
      if (!w.ok) return sendError(res, 'CART', 'KH-CART-006');
      return res.status(200).json({ status: 'ok', items: w.items, count: w.items.length });
    }
    if (action === 'wishlist-to-cart' && method === 'POST') {
      const slug = body(req).slug;
      if (typeof slug !== 'string' || slug.length > 90 || !SLUG_RE.test(slug)) return sendError(res, 'CART', 'KH-CART-003', { errors: ['That product could not be found.'] });
      const w = await wishlistFor(db, member.id);
      if (!w.ok) return sendError(res, 'CART', 'KH-CART-006');
      if (!w.items.some((i) => i.slug === slug)) return sendError(res, 'CART', 'KH-CART-003', { errors: ['That product is not on your wishlist.'] });
      const ids = await variantIdsForSlug(db, slug);
      const recs = await loadVariantRecords(db, ids);
      const buyable = ids.filter((id) => evaluateLine({ variantId: id, qty: 1 }, recs.get(id)).state !== 'unavailable');
      if (!buyable.length) return res.status(409).json({ status: 'unavailable', message: 'That product is not available to order right now.' });
      // A wishlist holds products, a bag holds pack sizes. With more than one size the customer chooses on the product page.
      if (buyable.length > 1) return res.status(409).json({ status: 'choose_size', message: 'Choose a pack size on the product page.' });
      const variantId = buyable[0]!;
      const current = (await getSavedCart(db, member.id)).find((l) => l.variantId === variantId)?.qty ?? 0;
      const qty = Math.min(current + 1, CART_MAX_QTY);
      if (evaluateLine({ variantId, qty }, recs.get(variantId)).state === 'unavailable') return res.status(409).json({ status: 'unavailable', message: 'That product is not available in that quantity.' });
      const s = await setSavedItem(db, member.id, variantId, qty);
      if (!s.ok) return s.failure.message.includes('bag is full') ? sendError(res, 'CART', 'KH-CART-004') : sendError(res, 'CART', 'KH-CART-003');
      const pid = await productIdForSlug(db, slug, false);
      if (pid) await wishlistTrackToCart(db, member.id, pid).catch(() => undefined);
      const saved = await getSavedCart(db, member.id);
      const all = await loadVariantRecords(db, saved.map((l) => l.variantId));
      return res.status(200).json(await signedView(db, member.id, saved, all, flags));
    }

    if (action === 'coupon-apply' && method === 'POST') {
      if (couponLimiter(ip)) return sendError(res, 'CART', 'KH-CART-005');
      const code = body(req).code;
      if (typeof code !== 'string' || code.length > 64) return sendError(res, 'CART', 'KH-CART-007', { message: couponMessage('NOT_FOUND') });
      const saved = await getSavedCart(db, member.id);
      if (!saved.length) return sendError(res, 'CART', 'KH-CART-007', { message: 'Add something to your bag before applying a coupon.' });
      const records = await loadVariantRecords(db, saved.map((l) => l.variantId));
      const priced = view(saved, records, flags);
      const r = await applyCoupon(db, member.id, code, priced.lines);
      if (!r.ok) return sendError(res, 'CART', 'KH-CART-006');
      if (!r.data.ok) return sendError(res, 'CART', 'KH-CART-007', { message: couponMessage(r.data.reason, r.data.min_order_paise), reason: r.data.reason });
      return res.status(200).json(await signedView(db, member.id, saved, records, flags));
    }

    if (action === 'coupon-remove' && method === 'POST') {
      const r = await removeCoupon(db, member.id);
      if (!r.ok) return sendError(res, 'CART', 'KH-CART-006');
      const saved = await getSavedCart(db, member.id);
      const records = await loadVariantRecords(db, saved.map((l) => l.variantId));
      return res.status(200).json(await signedView(db, member.id, saved, records, flags));
    }

    if (action === 'set' && method === 'POST') {
      const b = body(req);
      const qty = b.qty;
      if (!isUuid(b.variantId) || typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0 || qty > CART_MAX_QTY) return sendError(res, 'CART', 'KH-CART-003');
      const variantId = b.variantId.toLowerCase();
      if (qty > 0) {
        // Only things that can be bought may be added; removing is always allowed.
        const records = await loadVariantRecords(db, [variantId]);
        if (evaluateLine({ variantId, qty }, records.get(variantId)).state === 'unavailable') return sendError(res, 'CART', 'KH-CART-003', { errors: ['That item is not available to order.'] });
      }
      const r = await setSavedItem(db, member.id, variantId, qty);
      if (!r.ok) return r.failure.message.includes('bag is full') ? sendError(res, 'CART', 'KH-CART-004') : sendError(res, 'CART', 'KH-CART-003');
      const saved = await getSavedCart(db, member.id);
      const records = await loadVariantRecords(db, saved.map((l) => l.variantId));
      return res.status(200).json(await signedView(db, member.id, saved, records, flags));
    }

    if (action === 'merge' && method === 'POST') {
      const parsed = parseLines(body(req).lines);
      if (!parsed.ok) return sendError(res, 'CART', 'KH-CART-003', { errors: parsed.errors });
      // Only lines that can be bought are carried over from a guest bag.
      const records = await loadVariantRecords(db, parsed.lines.map((l) => l.variantId));
      const buyable = parsed.lines.filter((l) => evaluateLine(l, records.get(l.variantId)).state !== 'unavailable');
      if (buyable.length) {
        const r = await mergeSavedCart(db, member.id, buyable);
        if (!r.ok) return sendError(res, 'CART', 'KH-CART-006');
      }
      const saved = await getSavedCart(db, member.id);
      const all = await loadVariantRecords(db, saved.map((l) => l.variantId));
      return res.status(200).json(await signedView(db, member.id, saved, all, flags));
    }

    if (action === 'clear' && method === 'POST') {
      const r = await clearSavedCart(db, member.id);
      if (!r.ok) return sendError(res, 'CART', 'KH-CART-006');
      await removeCoupon(db, member.id);
      return res.status(200).json(view([], new Map(), flags));
    }

    return res.status(404).json({ status: 'error', message: 'Not found.' });
  } catch (e) {
    console.error('cart api error', e instanceof Error ? e.message : e);
    return sendError(res, 'CART', 'KH-CART-006');
  }
}
