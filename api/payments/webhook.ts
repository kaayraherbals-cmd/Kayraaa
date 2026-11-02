import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isHandledEvent, parseWebhook } from '../../shared/payments.js';
import { loadWebhookSecret, verifyWebhookSignature } from '../../server/razorpay.js';
import { queuePaymentConfirmedByRpOrder } from '../../server/outbox.js';
import { rpc } from '../../server/rpc.js';
import { rest, supabaseConfig } from '../../server/supabase.js';

/**
 * Razorpay webhook receiver. The signature is checked against the RAW body, so Vercel's body parser is switched off.
 * It is deliberately NOT blocked by COMMERCE_ENABLED: a payment that Razorpay has already taken must still be recorded.
 * With selling off no order can exist, so every event simply lands as "unknown_order".
 * Replies: 401 bad signature (Razorpay will not retry), 200 handled or ignored, 500 database trouble (Razorpay retries).
 */
export const config = { api: { bodyParser: false } };

const MAX_BYTES = 256 * 1024;
const NOTABLE = new Set(['captured', 'amount_mismatch', 'order_not_open', 'refund_processed', 'refund_failed', 'refund_unknown']);

async function readRaw(req: VercelRequest): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as unknown as AsyncIterable<Buffer | string>) {
    const b = typeof c === 'string' ? Buffer.from(c) : c;
    size += b.length;
    if (size > MAX_BYTES) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

const header = (req: VercelRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed.' });

  const secret = loadWebhookSecret();
  const db = supabaseConfig();
  if (!secret || !db) return res.status(503).json({ status: 'error', message: 'Not configured.' });

  const raw = await readRaw(req);
  if (!raw) return res.status(413).json({ status: 'error', message: 'Too large.' });
  if (!verifyWebhookSignature(raw, header(req, 'x-razorpay-signature'), secret)) return res.status(401).json({ status: 'error', message: 'Bad signature.' });

  let parsed;
  try {
    parsed = parseWebhook(JSON.parse(raw.toString('utf8')));
  } catch {
    parsed = null;
  }
  if (!parsed) return res.status(400).json({ status: 'error', message: 'Not a Razorpay event.' });
  if (!isHandledEvent(parsed.event)) return res.status(200).json({ status: 'ok', outcome: 'ignored' });

  // Razorpay's own event id makes redelivery harmless; the body hash is only a fallback if the header is ever missing.
  const sent = header(req, 'x-razorpay-event-id');
  const eventId = sent && sent.length >= 6 && sent.length <= 100 ? sent : `sha256:${createHash('sha256').update(raw).digest('hex')}`;

  const r = await rpc<string>(db, 'payment_apply_event', {
    p_event_id: eventId,
    p_event: parsed.event,
    p_rp_order: parsed.rp_order_id,
    p_rp_payment: parsed.rp_payment_id,
    p_rp_refund: parsed.rp_refund_id,
    p_amount: parsed.amount_paise,
    p_method: parsed.method,
    p_error_code: parsed.error_code,
    p_error_note: parsed.error_note,
  });
  if (!r.ok) {
    console.error('payment webhook: database call failed');
    return res.status(500).json({ status: 'error', message: 'Try again.' });
  }
  const outcome = typeof r.data === 'string' ? r.data : 'ok';
  if (outcome === 'captured' && parsed.rp_order_id) await queuePaymentConfirmedByRpOrder(db, parsed.rp_order_id);
  if (NOTABLE.has(outcome)) {
    try {
      await rest(db, 'admin_audit', { method: 'POST', body: JSON.stringify({ actor: 'razorpay', action: `payment_${outcome}`, detail: { event: parsed.event, rp_order: parsed.rp_order_id, rp_payment: parsed.rp_payment_id, rp_refund: parsed.rp_refund_id, amount_paise: parsed.amount_paise } }) });
    } catch {
      /* best effort, like every audit write */
    }
  }
  return res.status(200).json({ status: 'ok', outcome });
}
