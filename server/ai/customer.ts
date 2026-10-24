import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SAFETY_NOTE, cleanText, injectionSignal, medicalIntent, parseChatInput, replyProblems } from '../../shared/ai.js';
import { compactContextFor, contextFor, isProductTopic, rankProducts, realPrices, wantsWholeRange } from '../../shared/aiCatalog.js';
import { readFlags } from '../../shared/flags.js';
import { ORDER_STATUS_LABELS, formatInr, isOrderStatus } from '../../shared/orders.js';
import { REFUND_STATUS_LABELS, isRefundStatus } from '../../shared/refunds.js';
import { SHIPMENT_LABELS, isShipmentStatus } from '../../shared/shipments.js';
import { clientIp, createLimiter, limitDecision, originAllowed } from '../http.js';
import { findMemberByEmail } from '../members.js';
import { USER_COOKIE, verifyToken } from '../oauth.js';
import { MIN_SECRET_LENGTH } from '../session.js';
import { rest, supabaseConfig, type SupabaseConfig } from '../supabase.js';
import { loadCatalog } from './catalog.js';
import { customerDailyLimit, loadAiConfig, type AiConfig } from './config.js';
import { FAILURE_MESSAGE, type Transport } from './gemini.js';
import { generateWithFallback } from './providers.js';
import { contactFacts, deliveryFacts } from './liveFacts.js';
import { pagesFor } from './sitePages.js';
import { CUSTOMER_SCHEMA, CUSTOMER_SYSTEM } from './prompts.js';
import { recordTokens, reserveRequest } from './usage.js';

/**
 * Kaayra AI for customers: product discovery, comparison, shopping help and order questions.
 * Products and prices come from the database (the model can only choose among products the server retrieved), order data is only ever the
 * signed-in customer's own, the model has no tools and no database access, and nothing is stored about the conversation.
 * Shares the existing api/orders function (Vercel Hobby allows 12 functions in total, see SESSION_RULES.md).
 */
const chatLimiter = createLimiter(10 * 60 * 1000, 20, 'ai_chat', 'closed');
const ORDER_INTENT_RE = /\b(orders?|track\w*|shipments?|shipped|deliver\w*|parcel|package|refunds?|payments?|paid|invoice|cancel\w*|where is my)\b/i;
const FALLBACK_REPLY = 'I can only share approved Kaayra product information. Please look at the product pages, or contact our team for anything else.';
const FACTS_ONLY_REPLY = 'Our assistant cannot write an answer right now, but here is the information from our website.';
const INJECTION_REPLY = 'I can help with Kaayra products and your shopping questions. What would you like to know?';

/**
 * Speed settings. A shopper wants a short answer quickly, so the customer assistant asks Gemini for the lowest "thinking" level, a small
 * output cap (replies are at most about 1,100 characters) and a 15 second deadline. AI_THINKING_LEVEL / AI_MAX_OUTPUT_TOKENS / AI_TIMEOUT_MS
 * can still lower these (the timeout and token cap) or override the level.
 */
export const CUSTOMER_MAX_TOKENS = 1400;
export const CUSTOMER_TIMEOUT_MS = 15_000;
const REPLY_MAX = 1800;
const WHOLE_RANGE_MAX = 30;

/** Identical first questions (for example the suggested starters) are answered once and reused for a few minutes: instant and free. */
const REPLY_TTL_MS = 3 * 60 * 1000;
const REPLY_CACHE_MAX = 60;
type Cached = { at: number; body: Record<string, unknown> };
const replyCache = new Map<string, Cached>();
export const clearReplyCache = (): void => replyCache.clear();
const cacheGet = (key: string, now: number): Record<string, unknown> | null => {
  const hit = replyCache.get(key);
  if (!hit) return null;
  if (now - hit.at > REPLY_TTL_MS) { replyCache.delete(key); return null; }
  return hit.body;
};
const cachePut = (key: string, body: Record<string, unknown>, now: number): void => {
  if (replyCache.size >= REPLY_CACHE_MAX) { const oldest = replyCache.keys().next().value; if (oldest !== undefined) replyCache.delete(oldest); }
  replyCache.set(key, { at: now, body });
};

export async function currentMemberId(req: VercelRequest, db: SupabaseConfig): Promise<string | null> {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const raw = verifyToken<{ email: string }>('user', req.cookies?.[USER_COOKIE], secret);
  if (!raw || typeof raw.email !== 'string') return null;
  const m = await findMemberByEmail(db, raw.email);
  return m ? m.id : null;
}

interface OrderCtx { order_no: string; status: string; placed_on: string; total: string; shipments: { status: string; courier: string | null; tracking_no: string | null; estimated_delivery: string | null }[]; refunds: { status: string; amount: string }[] }

/**
 * The signed-in customer's own latest orders, selected by member_id in the query itself. Only status-level facts are returned: no name,
 * address, phone or email ever reaches the model.
 */
export async function loadOwnOrders(db: SupabaseConfig, memberId: string): Promise<OrderCtx[] | null> {
  try {
    const r = await rest(db, `orders?select=id,order_no,status,created_at,total_paise&member_id=eq.${encodeURIComponent(memberId)}&order=created_at.desc&limit=3`);
    if (!r.ok) return null;
    const orders = (await r.json()) as { id: string; order_no: string; status: string; created_at: string; total_paise: number }[];
    if (orders.length === 0) return [];
    const ids = orders.map((o) => o.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(',');
    const [sr, rr] = await Promise.all([
      rest(db, `shipments?select=order_id,status,courier,tracking_no,estimated_delivery&order_id=in.(${ids})`),
      rest(db, `order_refunds?select=order_id,status,amount_paise&order_id=in.(${ids})`),
    ]);
    if (!sr.ok || !rr.ok) return null;
    const ships = (await sr.json()) as { order_id: string; status: string; courier: string | null; tracking_no: string | null; estimated_delivery: string | null }[];
    const refs = (await rr.json()) as { order_id: string; status: string; amount_paise: number }[];
    return orders.map((o) => ({
      order_no: o.order_no,
      status: isOrderStatus(o.status) ? ORDER_STATUS_LABELS[o.status] : 'Unknown',
      placed_on: o.created_at.slice(0, 10),
      total: formatInr(o.total_paise),
      shipments: ships.filter((s) => s.order_id === o.id).map((s) => ({ status: isShipmentStatus(s.status) ? SHIPMENT_LABELS[s.status] : 'Unknown', courier: s.courier, tracking_no: s.tracking_no, estimated_delivery: s.estimated_delivery })),
      refunds: refs.filter((x) => x.order_id === o.id).map((x) => ({ status: isRefundStatus(x.status) ? REFUND_STATUS_LABELS[x.status] : 'Unknown', amount: formatInr(x.amount_paise) })),
    }));
  } catch {
    return null;
  }
}

/** JSON for the prompt with "<" escaped, so nothing inside it can close the <data> block. */
export const safeJson = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');

export interface ChatDeps { cfg: AiConfig; transport?: Transport }

export async function handleCustomerAi(req: VercelRequest, res: VercelResponse, action: string, deps: Partial<ChatDeps> = {}): Promise<void> {
  const cfg = deps.cfg ?? loadAiConfig();
  const send = (status: number, body: Record<string, unknown>) => res.status(status).json(body);
  if (action === 'ai-config') {
    if (req.method !== 'GET') return void send(405, { status: 'error', message: 'Method not allowed.' });
    return void send(200, { status: 'ok', enabled: cfg.ready });
  }
  if (action === 'ai-warm') {
    // Called when the panel opens: reads the catalogue now so the first question does not pay for it. Returns nothing about the shop.
    if (req.method !== 'GET') return void send(405, { status: 'error', message: 'Method not allowed.' });
    const db = cfg.ready ? supabaseConfig() : null;
    if (db) await loadCatalog(db, readFlags(process.env).cart_preview).catch(() => null);
    return void send(200, { status: 'ok' });
  }
  if (action !== 'ai-chat') return void send(404, { status: 'error', message: 'Not found.' });
  if (req.method !== 'POST') return void send(405, { status: 'error', message: 'Method not allowed.' });
  if (!(originAllowed(req) && req.headers['x-kaayra-csrf'] === '1')) return void send(403, { status: 'error', message: 'Request not allowed.' });
  if (!cfg.ready) return void send(200, { status: 'unavailable', message: 'Kaayra AI is not available right now. You can browse the shop or contact our team.' });

  const decision = await limitDecision(chatLimiter, clientIp(req));
  if (decision === 'unavailable') return void send(503, { status: 'unavailable', message: 'Kaayra AI is not available right now.' });
  if (decision === 'limited') { res.setHeader('Retry-After', '600'); return void send(429, { status: 'limited', message: 'You have asked a lot of questions. Please try again in a few minutes.' }); }

  const input = parseChatInput(req.body);
  if (!input.ok) return void send(400, { status: 'invalid', message: input.message });
  if (injectionSignal(input.message)) return void send(200, { status: 'ok', reply: INJECTION_REPLY, products: [], handoff: false, followUps: [] });

  const db = supabaseConfig();
  if (!db) return void send(503, { status: 'unavailable', message: 'Kaayra AI is not available right now.' });

  try {
    const now = Date.now();
    // Prices are shown to the assistant exactly when the shop shows them (the same flag api/cart uses), never earlier.
    const withPrices = readFlags(process.env).cart_preview;
    const wantsOrders = ORDER_INTENT_RE.test(input.message);
    // Step 1, at the same time: the catalogue (cached) and, only for order questions, who the signed-in customer is.
    const [catalog, memberId] = await Promise.all([loadCatalog(db, withPrices), wantsOrders ? currentMemberId(req, db) : Promise.resolve(null)]);
    if (!catalog) return void send(200, { status: 'unavailable', message: 'I cannot reach the product information just now. Please try again shortly.' });

    // Retrieval: the products relevant to this message (and the previous customer message, for follow-ups such as "compare them").
    const lastUser = [...input.history].reverse().find((t) => t.role === 'user')?.text ?? '';
    const hits = rankProducts(catalog, `${input.message} ${lastUser}`.trim(), 6);
    // A question about the whole range ("ingredients of each product", "all products") or about a product fact with no product named gets the whole
    // catalogue (compact), so the assistant can list real details instead of sending the customer to the shop page.
    const whole = wantsWholeRange(input.message) || (hits.length === 0 && isProductTopic(input.message));
    const shown = whole ? catalog.slice(0, WHOLE_RANGE_MAX) : hits;
    const context = whole ? compactContextFor(shown) : contextFor(shown);
    // The website's own page text for questions about the site itself (story, approach, quality, ingredient library, journal, policies).
    const sitePages = pagesFor(`${input.message} ${lastUser}`.trim());
    // Live facts from the shop's own systems: delivery for a PIN code the customer typed, and the contact details the owner has set up.
    const delivery = await deliveryFacts(db, input.message, withPrices);
    const contact = contactFacts(process.env);

    // A first, non-personal question that was answered a moment ago for the same products and prices is answered from that: no model call, no budget used.
    const cacheKey = input.history.length === 0 && !wantsOrders ? createHash('sha1').update(`${input.message.toLowerCase()}|${safeJson(context)}|${safeJson(sitePages)}|${safeJson(delivery)}|${safeJson(contact)}`).digest('hex') : null;
    const cached = cacheKey ? cacheGet(cacheKey, now) : null;
    if (cached) return void send(200, cached);

    // Step 2, at the same time: the customer's own orders (if asked) and the daily budget reservation.
    const [orders, budget] = await Promise.all([memberId ? loadOwnOrders(db, memberId) : Promise.resolve(null), reserveRequest(db, 'customer', customerDailyLimit(cfg))]);
    if (budget === 'unavailable') return void send(503, { status: 'unavailable', message: 'Kaayra AI is not available right now.' });
    if (budget === 'limit') return void send(429, { status: 'limit', message: 'Kaayra AI has reached its limit for today. Please try again tomorrow, or contact our team.' });

    const data = safeJson({
      products: context,
      ...(sitePages.length > 0 ? { website_pages: sitePages } : {}),
      ...(delivery.length > 0 ? { delivery_check: delivery } : {}),
      contact_details: Object.keys(contact).length > 0 ? contact : 'not published yet; use the contact form on the Contact page',
      signed_in: Boolean(memberId),
      ...(wantsOrders ? { customer_orders: memberId ? orders ?? 'unavailable' : 'not signed in' } : {}),
      conversation: input.history,
      customer_message: input.message,
    });
    const result = await generateWithFallback(
      { ...cfg, maxOutputTokens: Math.min(cfg.maxOutputTokens, CUSTOMER_MAX_TOKENS) },
      { system: CUSTOMER_SYSTEM, user: `<data>${data}</data>`, schema: CUSTOMER_SCHEMA as unknown as Record<string, unknown>, temperature: 0.3, thinkingLevel: 'MINIMAL', timeoutMs: CUSTOMER_TIMEOUT_MS },
      deps.transport,
    );
    await recordTokens(db, 'customer', result.inputTokens, result.outputTokens);
    // Order details come straight from the database (the signed-in customer's own orders, status-level facts only), never from the model's wording.
    const ordersOut = wantsOrders && memberId && Array.isArray(orders) ? orders : [];
    const needsSignIn = wantsOrders && !memberId;
    if (!result.ok) {
      // The assistant could not write an answer: still show the real information from the website (matching products, the customer's own orders).
      const cards = shown.slice(0, 3).map((p) => p.slug);
      if (cards.length > 0 || ordersOut.length > 0 || needsSignIn) return void send(200, { status: 'ok', reply: FACTS_ONLY_REPLY, products: cards, orders: ordersOut, needsSignIn, handoff: false, followUps: [] });
      return void send(200, { status: 'unavailable', message: FAILURE_MESSAGE[result.reason] });
    }

    let reply = typeof result.json.reply === 'string' ? result.json.reply.trim().slice(0, REPLY_MAX) : '';
    const allowed = new Set(shown.map((p) => p.slug));
    const slugs = Array.isArray(result.json.product_slugs) ? [...new Set((result.json.product_slugs as unknown[]).filter((s): s is string => typeof s === 'string' && allowed.has(s)))].slice(0, 3) : [];
    const prices = realPrices(shown);
    if (!reply || replyProblems(reply, prices).length > 0) reply = FALLBACK_REPLY;
    if (medicalIntent(input.message) && !/healthcare professional/i.test(reply)) reply = `${reply}\n\n${SAFETY_NOTE}`;
    const fellBack = reply === FALLBACK_REPLY;
    // Suggested next questions go through the same checks as a reply; any that fail are simply dropped.
    const followUps = fellBack || !Array.isArray(result.json.follow_ups) ? [] : [...new Set((result.json.follow_ups as unknown[]).filter((q): q is string => typeof q === 'string').map((q) => cleanText(q, 60)).filter((q) => q.length >= 3 && q.length <= 50 && !injectionSignal(q) && !medicalIntent(q) && replyProblems(q, prices).length === 0))].slice(0, 3);
    const body = { status: 'ok', reply, products: slugs, orders: ordersOut, needsSignIn, handoff: result.json.needs_human === true || fellBack, followUps };
    if (cacheKey && !fellBack && !medicalIntent(input.message)) cachePut(cacheKey, body, now);
    return void send(200, body);
  } catch (e) {
    console.error('ai chat error', e instanceof Error ? e.name : 'error');
    return void send(502, { status: 'error', message: 'Kaayra AI is not available right now.' });
  }
}
