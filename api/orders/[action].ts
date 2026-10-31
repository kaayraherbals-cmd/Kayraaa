import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseOrderId, shapeShipments } from '../../shared/tracking.js';
import { clientIp, createLimiter, isLimited } from '../../server/http.js';
import { findMemberByEmail } from '../../server/members.js';
import { USER_COOKIE, verifyToken } from '../../server/oauth.js';
import { handleCustomerAi } from '../../server/ai/customer.js';
import { rpc } from '../../server/rpc.js';
import { MIN_SECRET_LENGTH } from '../../server/session.js';
import { rest, supabaseConfig, type SupabaseConfig } from '../../server/supabase.js';

/**
 * Customer orders API: `list` (own orders) and `track` (own order's shipments). Signed-in customers only; the order id from the
 * browser is never trusted alone: ownership is enforced by member_id in the query and inside shipments_for_member().
 * Works in every environment (existing customers must be able to see their orders), it creates nothing.
 */
const limiter = createLimiter(60 * 1000, 60, 'orders_read');
const PAGE_SIZE = 10;
const totalFrom = (r: Response, fallback: number): number => {
  const n = Number((r.headers.get('content-range') ?? '').split('/')[1]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

async function currentMember(req: VercelRequest, db: SupabaseConfig): Promise<{ id: string } | null> {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const raw = verifyToken<{ email: string }>('user', req.cookies?.[USER_COOKIE], secret);
  if (!raw || typeof raw.email !== 'string') return null;
  const m = await findMemberByEmail(db, raw.email);
  return m ? { id: m.id } : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const action = String(req.query.action ?? '');
  // Kaayra AI (customer assistant) shares this function: Vercel Hobby allows only 12 functions and api/ is full.
  if (action.startsWith('ai-')) return handleCustomerAi(req, res, action);
  if (req.method !== 'GET') return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
  if (!['list', 'track', 'detail'].includes(action)) return res.status(404).json({ status: 'error', message: 'Not found.' });
  if (await isLimited(limiter, clientIp(req))) return res.status(429).json({ status: 'error', message: 'Too many requests. Try again shortly.' });
  const db = supabaseConfig();
  if (!db) return res.status(503).json({ status: 'error', message: 'Orders are unavailable right now.' });
  try {
    const member = await currentMember(req, db);
    if (!member) return res.status(401).json({ status: 'error', message: 'Please sign in.' });
    if (action === 'list') {
      const page = Math.min(1000, Math.max(1, Math.floor(Number(req.query.page)) || 1));
      const r = await rest(db, `orders?select=id,order_no,status,created_at,total_paise,is_test,ship_address,ship_pincode,customer_name,order_refunds(status,amount_paise)&member_id=eq.${member.id}&order=created_at.desc&limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`, { headers: { Prefer: 'count=exact' } });
      if (!r.ok) throw new Error(`orders ${r.status}`);
      const items = (await r.json()) as unknown[];
      return res.status(200).json({ status: 'ok', items, page, pageSize: PAGE_SIZE, total: totalFrom(r, (page - 1) * PAGE_SIZE + items.length) });
    }
    if (action === 'detail') {
      const did = parseOrderId(req.query.order);
      if (!did) return res.status(400).json({ status: 'invalid', message: 'Invalid order.' });
      const o = await rest(db, `orders?select=id,order_no,status,created_at,customer_name,ship_address,ship_pincode,subtotal_paise,discount_paise,coupon_code,shipping_paise,total_paise,is_test&id=eq.${did}&member_id=eq.${member.id}&limit=1`);
      if (!o.ok) throw new Error(`order ${o.status}`);
      const order = ((await o.json()) as Record<string, unknown>[])[0];
      if (!order) return res.status(404).json({ status: 'error', message: 'Not found.' });
      const [it, rf] = await Promise.all([
        rest(db, `order_items?select=product_name,pack_size,qty,unit_price_paise,line_total_paise&order_id=eq.${did}&order=product_name.asc`),
        rest(db, `order_refunds?select=kind,status,amount_paise,requested_at,decided_at,refunded_at&order_id=eq.${did}&order=requested_at.desc`),
      ]);
      if (!it.ok || !rf.ok) throw new Error(`order detail ${it.status}/${rf.status}`);
      return res.status(200).json({ status: 'ok', order, items: await it.json(), refunds: await rf.json() });
    }
    const id = parseOrderId(req.query.order);
    if (!id) return res.status(400).json({ status: 'invalid', message: 'Invalid order.' });
    const own = await rest(db, `orders?select=id,order_no,status,created_at&id=eq.${id}&member_id=eq.${member.id}&limit=1`);
    if (!own.ok) throw new Error(`order ${own.status}`);
    const order = ((await own.json()) as Record<string, unknown>[])[0];
    if (!order) return res.status(404).json({ status: 'error', message: 'Not found.' });
    const s = await rpc<unknown>(db, 'shipments_for_member', { p_member: member.id, p_order: id });
    if (!s.ok) return res.status(502).json({ status: 'error', message: 'Tracking is unavailable right now.' });
    return res.status(200).json({ status: 'ok', order, shipments: shapeShipments(s.data) });
  } catch (e) {
    console.error('orders api error', e instanceof Error ? e.name : 'error');
    return res.status(502).json({ status: 'error', message: 'Orders are unavailable right now.' });
  }
}
