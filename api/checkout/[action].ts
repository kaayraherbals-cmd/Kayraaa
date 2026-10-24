import type { VercelRequest, VercelResponse } from '@vercel/node';
import { priceCart, type CartLineView } from '../../shared/cart.js';
import { canonicalRequest, checkoutOpen, isValidPin, checkoutTotals, flattenAddress, isTestOrder, ORDER_HOLD_MINUTES, quoteShipping, validatePlaceRequest, validateQuoteRequest, type PlaceRequest } from '../../shared/checkout.js';
import { readFlags } from '../../shared/flags.js';
import { getSavedCart, loadVariantRecords } from '../../server/cart.js';
import { priceWithSavedCoupon } from '../../server/coupons.js';
import { loadShippingRow, placeOrder, readOwnOrder, requestHash } from '../../server/checkout.js';
import { runOutboxJob, queueOrderCreated } from '../../server/outbox.js';
import { mailConfig } from '../../server/mail.js';
import { runRecoveryJob } from '../../server/recovery.js';
import { cancelAction, cronAuthorised, payAction, paymentEnv, reconcileExpired, statusAction, verifyAction } from '../../server/checkoutPayments.js';
import { validateOrderRef, validateVerifyRequest } from '../../shared/payments.js';
import { sendError } from '../../server/errors.js';
import { clientIp, createLimiter, isLimited, limitDecision, originAllowed } from '../../server/http.js';
import { findMemberByEmail } from '../../server/members.js';
import { USER_COOKIE, verifyToken } from '../../server/oauth.js';
import { MIN_SECRET_LENGTH } from '../../server/session.js';
import { supabaseConfig, type SupabaseConfig } from '../../server/supabase.js';

/**
 * Checkout API (development testing only). Closed (404) unless checkoutOpen(): the master switch, or the checkout-testing flag
 * together with the bag preview flag; the flags cannot be on in production (shared/flags.ts).
 *
 * Items come from the signed-in customer's saved bag, never from the request. Prices, GST, shipping and the total are
 * recalculated here and again inside the database. The one number the browser sends, expectedTotalPaise, is a consent check:
 * if the real total differs, no order is created.
 *
 * `place` creates an unpaid order and reserves stock. Payment (Section 4) is a separate step on the same route:
 *   pay     creates or reuses the Razorpay order for the member's own unpaid order (amount read from the database)
 *   verify  confirms the browser's Razorpay callback with Razorpay itself before the database may mark the order paid
 *   status  reads the order and payment state of the member's own order (the page polls it while a payment settles)
 *   cancel  withdraws the member's own unpaid order and releases its stock
 * pay and verify are closed (404) unless paymentsOpen(): checkout open AND the payment-test flag with a Razorpay TEST key.
 * reconcile is for a scheduler: it needs CRON_SECRET, works whatever the flags say (releasing stock must never be switched off)
 * and only ever returns counts.
 */
const MIN = 60 * 1000;
const ipLimiter = createLimiter(MIN, 30, 'checkout_ip');
const placeLimiter = createLimiter(10 * MIN, 10, 'checkout_place', 'closed');
const payLimiter = createLimiter(10 * MIN, 20, 'checkout_pay', 'closed');
const verifyLimiter = createLimiter(10 * MIN, 30, 'checkout_verify');

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

async function currentMember(req: VercelRequest, db: SupabaseConfig): Promise<{ id: string; email: string } | null> {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const raw = verifyToken<{ email: string; name: string | null; role: string }>('user', req.cookies?.[USER_COOKIE], secret);
  if (!raw || typeof raw.email !== 'string') return null;
  const m = await findMemberByEmail(db, raw.email);
  return m ? { id: m.id, email: m.email } : null;
}

const needsAttention = (lines: CartLineView[]) => lines.some((l) => l.state !== 'ok');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const action = String(req.query.action ?? '');
  const method = req.method ?? 'GET';
  const flags = readFlags(process.env);
  const open = checkoutOpen(flags);

  const pay = paymentEnv(flags);

  if (action === 'config' && method === 'GET') return res.status(200).json({ status: 'ok', checkoutOpen: open, paymentOpen: open && pay.open });

  // Scheduler hook: settle late payments, then release stock held by unpaid orders whose window ended. Counts only, no personal data.
  if (action === 'reconcile') {
    if (!['GET', 'POST'].includes(method)) return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
    const h = req.headers.authorization;
    if (!cronAuthorised(Array.isArray(h) ? h[0] : h)) return res.status(404).json({ status: 'error', message: 'Not found.' });
    const rdb = supabaseConfig();
    if (!rdb) return sendError(res, 'PAY', 'KH-PAY-008');
    try {
      return res.status(200).json({ status: 'ok', ...(await reconcileExpired(rdb, pay.cfg, 25)) });
    } catch (e) {
      console.error('reconcile error', e instanceof Error ? e.message : e);
      return sendError(res, 'PAY', 'KH-PAY-007');
    }
  }

  // Scheduler hook for email: queue any verified-but-unqueued mail, send what is due (with retries), tidy old rows. Counts only.
  if (action === 'outbox') {
    if (!['GET', 'POST'].includes(method)) return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
    const h = req.headers.authorization;
    if (!cronAuthorised(Array.isArray(h) ? h[0] : h)) return res.status(404).json({ status: 'error', message: 'Not found.' });
    const odb = supabaseConfig();
    if (!odb) return sendError(res, 'PAY', 'KH-PAY-008');
    try {
      const mcfg = mailConfig();
      const outboxResult = await runOutboxJob(odb, mcfg);
      // Cart recovery rides on this same scheduled call (Vercel Hobby has no spare cron slots). A recovery problem never affects the
      // order mail above: it is caught here and reported as a status only.
      let recovery: unknown;
      try {
        recovery = await runRecoveryJob(odb, mcfg);
      } catch (e) {
        console.error('recovery job error', e instanceof Error ? e.name : 'error');
        recovery = { status: 'error' };
      }
      return res.status(200).json({ status: 'ok', ...outboxResult, recovery });
    } catch (e) {
      console.error('outbox job error', e instanceof Error ? e.name : 'error');
      return sendError(res, 'PAY', 'KH-PAY-007');
    }
  }

  // Cart recovery on its own, for an external scheduler that can run more often than Vercel Hobby's daily cron (see docs/PHASE7_CART_RECOVERY.md).
  if (action === 'recovery') {
    if (!['GET', 'POST'].includes(method)) return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
    const h = req.headers.authorization;
    if (!cronAuthorised(Array.isArray(h) ? h[0] : h)) return res.status(404).json({ status: 'error', message: 'Not found.' });
    const rdb = supabaseConfig();
    if (!rdb) return sendError(res, 'PAY', 'KH-PAY-008');
    try {
      return res.status(200).json({ status: 'ok', recovery: await runRecoveryJob(rdb, mailConfig()) });
    } catch (e) {
      console.error('recovery job error', e instanceof Error ? e.name : 'error');
      return sendError(res, 'PAY', 'KH-PAY-007');
    }
  }

  // Public delivery check for the product page: a PIN code in, "can we deliver there and at what rate" out. Reads only the
  // serviceability table; no session, no personal data. Rate limited by IP like the rest of this route.
  if (action === 'pincode') {
    if (method !== 'GET') return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
    const pin = String(req.query.pin ?? '').trim();
    if (!isValidPin(pin)) return res.status(400).json({ status: 'invalid', message: 'Enter a valid 6-digit PIN code.' });
    if (await isLimited(ipLimiter, clientIp(req))) return res.status(429).json({ status: 'error', message: 'Too many requests. Try again shortly.' });
    const pdb = supabaseConfig();
    if (!pdb) return res.status(503).json({ status: 'error', message: 'Delivery checks are unavailable right now.' });
    try {
      const row = await loadShippingRow(pdb, pin);
      const q = quoteShipping(row, 0);
      return res.status(200).json({ status: 'ok', pincode: pin, serviceable: q.serviceable, ratePaise: q.serviceable ? q.shippingPaise : null, freeAbovePaise: q.serviceable ? (row?.freeAbovePaise ?? null) : null });
    } catch (e) {
      console.error('pincode error', e instanceof Error ? e.name : 'error');
      return res.status(502).json({ status: 'error', message: 'Delivery checks are unavailable right now.' });
    }
  }

  if (!open) return sendError(res, 'CHECKOUT', 'KH-CHK-001');
  const PAY_ACTIONS = ['pay', 'verify', 'status', 'cancel'];
  if (!['quote', 'place', ...PAY_ACTIONS].includes(action)) return res.status(404).json({ status: 'error', message: 'Not found.' });
  if (method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
  if (!(originAllowed(req) && req.headers['x-kaayra-csrf'] === '1')) return res.status(403).json({ status: 'error', message: 'Request not allowed.' });
  if (await isLimited(ipLimiter, clientIp(req))) return sendError(res, 'CHECKOUT', 'KH-CHK-006');

  const db = supabaseConfig();
  if (!db) return sendError(res, 'CHECKOUT', 'KH-CHK-001');

  try {
    const member = await currentMember(req, db);
    if (!member) return PAY_ACTIONS.includes(action) ? sendError(res, 'PAY', 'KH-PAY-002') : sendError(res, 'CHECKOUT', 'KH-CHK-002');

    if (PAY_ACTIONS.includes(action)) {
      if (action === 'pay' || action === 'verify') {
        if (!pay.open) return sendError(res, 'PAY', 'KH-PAY-001');
        if (!pay.cfg) return sendError(res, 'PAY', 'KH-PAY-008');
        // Starting a payment fails CLOSED (nothing is charged when refused). Verifying one never does: a customer who has paid must be recorded.
        const gate = await limitDecision(action === 'pay' ? payLimiter : verifyLimiter, member.id);
        if (gate === 'unavailable') return sendError(res, 'PAY', 'KH-PAY-009');
        if (gate === 'limited') return sendError(res, 'PAY', 'KH-PAY-006');
      }
      if (action === 'verify') {
        const v = validateVerifyRequest(body(req));
        if (!v.ok) return sendError(res, 'PAY', 'KH-PAY-003');
        return await verifyAction(res, db, pay.cfg!, member.id, v.value);
      }
      const ref = validateOrderRef(body(req));
      if (!ref.ok) return sendError(res, 'PAY', 'KH-PAY-003');
      if (action === 'pay') return await payAction(res, db, pay.cfg!, member.id, ref.orderId);
      if (action === 'status') return await statusAction(res, db, member.id, ref.orderId);
      return await cancelAction(res, db, member.id, ref.orderId);
    }

    const parsed = action === 'quote' ? validateQuoteRequest(body(req)) : validatePlaceRequest(body(req));
    if (!parsed.ok) return sendError(res, 'CHECKOUT', 'KH-CHK-003', { message: parsed.message, fields: parsed.errors });
    const address = parsed.value.address;

    // Items come from the customer's own saved bag, priced fresh from the database.
    const saved = await getSavedCart(db, member.id);
    if (!saved.length) return sendError(res, 'CHECKOUT', 'KH-CHK-004', { message: 'Your bag is empty.' });
    const records = await loadVariantRecords(db, saved.map((l) => l.variantId));
    const { lines, totals } = priceCart(saved, records);
    if (needsAttention(lines)) return sendError(res, 'CHECKOUT', 'KH-CHK-004', { lines, totals });

    const shipRow = await loadShippingRow(db, address.pincode);
    const quote = quoteShipping(shipRow, totals.subtotalPaise);
    if (!quote.serviceable) return sendError(res, 'CHECKOUT', 'KH-CHK-005', { fields: { pincode: quote.label } });
    // The coupon comes from the member's saved bag on the server and is re-checked now by the database; the request never names one.
    const pc = await priceWithSavedCoupon(db, member.id, lines, records, quote.shippingPaise, totals.gstIncludedPaise);
    const t = checkoutTotals(totals.subtotalPaise, pc.gstIncludedPaise, quote.shippingPaise, pc.discountPaise);

    if (action === 'quote') {
      return res.status(200).json({ status: 'ok', lines, totals: t, coupon: pc.applied, shipping: { label: quote.label, paise: quote.shippingPaise }, currency: 'INR', pricesIncludeGst: true, test: isTestOrder(flags) });
    }

    // ---- place: unpaid order + stock reservation, atomically and idempotently --------------------------
    const place = parsed.value as PlaceRequest;
    const placeGate = await limitDecision(placeLimiter, member.id);
    if (placeGate === 'unavailable') return sendError(res, 'CHECKOUT', 'KH-CHK-009');
    if (placeGate === 'limited') return sendError(res, 'CHECKOUT', 'KH-CHK-006');
    // Free stock held by orders nobody paid for, so it is not wrongly reported as sold out. Never blocks the order.
    try {
      await reconcileExpired(db, pay.cfg, 5);
    } catch {
      /* the scheduled sweep will catch up */
    }
    // A coupon that no longer qualifies stops the order (the customer removes it or fixes the bag) rather than silently charging full price.
    if (pc.applied && !pc.applied.valid) return sendError(res, 'CHECKOUT', 'KH-CHK-004', { message: `${pc.applied.code}: ${pc.applied.message ?? 'this coupon cannot be applied.'} Remove the coupon to continue.`, coupon: pc.applied });
    const couponCode = pc.applied?.code ?? null;
    const hash = requestHash(canonicalRequest(saved, address, couponCode, place.loyaltyPoints ?? 0));
    const r = await placeOrder(db, {
      memberId: member.id,
      key: place.idempotencyKey,
      hash,
      order: {
        customer_name: address.name,
        customer_email: member.email,
        customer_phone: address.phone,
        ship_address: flattenAddress(address),
        ship_pincode: address.pincode,
        shipping_paise: quote.shippingPaise,
        items: saved.map((l) => ({ variant_id: l.variantId, qty: l.qty })),
      },
      expectedTotalPaise: place.expectedTotalPaise,
      test: isTestOrder(flags),
      holdMinutes: ORDER_HOLD_MINUTES,
      couponCode,
      loyaltyPoints: place.loyaltyPoints ?? 0,
    });
    if (!r.ok) {
      const f = r.failure;
      if (f.kind === 'insufficient_stock' || /price changed|no longer|not approved|switched off|no price|points|rewards|coupons cannot|bundle/i.test(f.message)) return sendError(res, 'CHECKOUT', 'KH-CHK-004', { message: f.message });
      if (/PIN code/i.test(f.message)) return sendError(res, 'CHECKOUT', 'KH-CHK-005');
      if (/different order/i.test(f.message)) return sendError(res, 'CHECKOUT', 'KH-CHK-008');
      if (f.kind === 'state') return sendError(res, 'CHECKOUT', 'KH-CHK-004', { message: f.message });
      return sendError(res, 'CHECKOUT', 'KH-CHK-007');
    }
    if (!r.data.replay) await queueOrderCreated(db, r.data.order_id);
    const order = await readOwnOrder(db, member.id, r.data.order_id);
    if (!order) return sendError(res, 'CHECKOUT', 'KH-CHK-007');
    return res.status(200).json({ status: 'ok', replay: r.data.replay, order, paymentOpen: pay.open });
  } catch (e) {
    console.error('checkout api error', e instanceof Error ? e.message : e);
    return PAY_ACTIONS.includes(action) ? sendError(res, 'PAY', 'KH-PAY-007') : sendError(res, 'CHECKOUT', 'KH-CHK-007');
  }
}
