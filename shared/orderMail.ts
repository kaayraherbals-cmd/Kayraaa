/**
 * Transactional order and shipping email templates (Phase 7, Step 2). Pure functions, like shared/mailTemplates.ts.
 *
 * Rules:
 *  - Fixed subjects. Customer-supplied text (name) is escaped in HTML and never goes into a subject or header.
 *  - Only facts the backend has verified are stated. Payment confirmed says "received"; a refund is "started" until the
 *    provider confirms it, and only refund_completed says it was confirmed. No delivery-time promises, no health claims.
 *  - No street address, phone number or full card detail is ever included.
 *  - These are service messages about an order the customer placed. They carry no marketing content, and are sent
 *    regardless of marketing consent (which is stored and honoured separately).
 */
import { escapeHtml, layout, oneLine, para, type BuiltMail, type OrderMailKind } from './mailTemplates.js';

export interface OrderMailItem {
  name: string;
  packSize: string;
  qty: number;
}

export interface OrderMailParams {
  name?: string | null;
  orderNo: string;
  totalPaise?: number | null;
  items?: OrderMailItem[];
  courier?: string | null;
  trackingNo?: string | null;
  refundPaise?: number | null;
  /** Customer-support address, from configuration. When null the mail asks the customer to reply to it. */
  supportEmail?: string | null;
}

const ORDER_NO = /^KH-\d{4}-\d{6,}$/;

export function rupees(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = String(paise % 100).padStart(2, '0');
  return `\u20B9${whole.toLocaleString('en-IN')}.${frac}`;
}

function greeting(name?: string | null) {
  const first = oneLine(name ?? '', 80).split(' ')[0];
  return { html: first ? `Hello ${escapeHtml(first)},` : 'Hello,', text: first ? `Hello ${first},` : 'Hello,' };
}

function itemsBlock(items: OrderMailItem[] | undefined): { html: string; text: string } {
  if (!items?.length) return { html: '', text: '' };
  const rows = items.slice(0, 20).map((i) => ({ label: `${oneLine(i.name, 120)} (${oneLine(i.packSize, 40)})`, qty: Math.max(1, Math.floor(i.qty)) }));
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;width:100%;">${rows
      .map((r) => `<tr><td style="padding:4px 0;border-bottom:1px solid #eee6d4;">${escapeHtml(r.label)}</td><td align="right" style="padding:4px 0;border-bottom:1px solid #eee6d4;">&times; ${r.qty}</td></tr>`)
      .join('')}</table>`,
    text: rows.map((r) => `- ${r.label} x ${r.qty}`).join('\n') + '\n\n',
  };
}

function trackingLines(p: OrderMailParams): { html: string; text: string } {
  const c = p.courier ? oneLine(p.courier, 60) : '';
  const t = p.trackingNo ? oneLine(p.trackingNo, 60) : '';
  if (!c && !t) return { html: '', text: '' };
  return {
    html: para(`${c ? `<strong>Courier:</strong> ${escapeHtml(c)}<br>` : ''}${t ? `<strong>Tracking number:</strong> ${escapeHtml(t)}` : ''}`),
    text: `${c ? `Courier: ${c}\n` : ''}${t ? `Tracking number: ${t}\n` : ''}\n`,
  };
}

function build(kind: OrderMailKind, subject: string, title: string, p: OrderMailParams, lead: string[], extra?: { html: string; text: string }): BuiltMail {
  if (!ORDER_NO.test(p.orderNo)) throw new Error('bad order reference');
  const g = greeting(p.name);
  const support = p.supportEmail ? oneLine(p.supportEmail, 254) : null;
  const help = support ? `If you have a question about this order, write to ${support} and quote the order reference.` : 'If you have a question about this order, reply to this email and quote the order reference.';
  const footer = `Order reference ${escapeHtml(p.orderNo)}. This is a service message about an order placed on the Kaayra Herbals website. ${escapeHtml(help)}`;
  const html = layout(
    title,
    para(g.html) + lead.map((l) => para(escapeHtml(l))).join('') + (extra?.html ?? '') + para(`<strong>Order reference:</strong> ${escapeHtml(p.orderNo)}`) + para(escapeHtml(help)),
    footer,
  );
  const text = `${g.text}\n\n${lead.join('\n\n')}\n\n${extra?.text ?? ''}Order reference: ${p.orderNo}\n\n${help}\n\n--\nKaayra Herbals. This is a service message about an order placed on the Kaayra Herbals website.`;
  return { kind, subject, html, text };
}

const total = (p: OrderMailParams) => (typeof p.totalPaise === 'number' && p.totalPaise >= 0 ? ` of ${rupees(p.totalPaise)}` : '');

export function orderCreatedMail(p: OrderMailParams): BuiltMail {
  const it = itemsBlock(p.items);
  return build('order_created', 'We have received your order', 'We have received your order', p, [
    `Thank you for your order${total(p)}. It is placed and waiting for payment.`,
    'Your order is confirmed as paid only when we receive a payment confirmation, and you will get a separate email then. An unpaid order is released automatically after a short time.',
  ], it);
}

/** Only ever queued after the backend has verified a captured payment (see server/orderMail.ts). */
export function paymentConfirmedMail(p: OrderMailParams): BuiltMail {
  const it = itemsBlock(p.items);
  return build('payment_confirmed', 'Payment received for your order', 'Payment received', p, [`We have received your payment${total(p)}. Thank you.`, 'We will email you again when your order is dispatched.'], it);
}

export function paymentFailedMail(p: OrderMailParams): BuiltMail {
  return build('payment_failed', 'Your payment did not go through', 'Payment did not go through', p, [
    'We could not complete the payment for your order, so it has not been marked as paid.',
    'If any amount was taken from your account, your bank or the payment provider will normally return it. You can try again from the website while your order is still open.',
  ]);
}

export function orderCancelledMail(p: OrderMailParams): BuiltMail {
  return build('order_cancelled', 'Your order has been cancelled', 'Order cancelled', p, [
    'Your order has been cancelled.',
    'If you had already paid, we will start a refund and email you at each step. We will not say a refund is complete until the payment provider confirms it.',
  ], itemsBlock(p.items));
}

export function shipmentDispatchedMail(p: OrderMailParams): BuiltMail {
  const t = trackingLines(p);
  return build('shipment_dispatched', 'Your order has been dispatched', 'Order dispatched', p, ['Your order has been handed over for delivery.'], { html: t.html + itemsBlock(p.items).html, text: t.text + itemsBlock(p.items).text });
}

export function outForDeliveryMail(p: OrderMailParams): BuiltMail {
  const t = trackingLines(p);
  return build('out_for_delivery', 'Your order is out for delivery', 'Out for delivery', p, ['Your order is out for delivery.'], t);
}

export function deliveredMail(p: OrderMailParams): BuiltMail {
  return build('delivered', 'Your order has been delivered', 'Order delivered', p, ['Your order is marked as delivered.', 'If something is not right with what you received, please contact us and quote the order reference.']);
}

/** Says a refund has been STARTED, never that money has arrived. */
export function refundInitiatedMail(p: OrderMailParams): BuiltMail {
  const amt = typeof p.refundPaise === 'number' && p.refundPaise > 0 ? ` of ${rupees(p.refundPaise)}` : '';
  return build('refund_initiated', 'We have started your refund', 'Refund started', p, [
    `We have started a refund${amt} to your original payment method.`,
    'The time it takes to show in your account depends on your bank. We will email you again when the payment provider confirms the refund.',
  ]);
}

/** Only queued after the payment provider has confirmed the refund. */
export function refundCompletedMail(p: OrderMailParams): BuiltMail {
  const amt = typeof p.refundPaise === 'number' && p.refundPaise > 0 ? ` of ${rupees(p.refundPaise)}` : '';
  return build('refund_completed', 'Your refund has been processed', 'Refund processed', p, [
    `The payment provider has confirmed your refund${amt}.`,
    'Your bank may take some time to show it in your account.',
  ]);
}

export function returnReceivedMail(p: OrderMailParams): BuiltMail {
  return build('return_received', 'We have received your returned parcel', 'Return received', p, [
    'We have received your returned parcel.',
    'We will check it and write to you about the next step. We will not mark a refund as done until the payment provider confirms it.',
  ]);
}

export const ORDER_MAIL_BUILDERS: Record<OrderMailKind, (p: OrderMailParams) => BuiltMail> = {
  order_created: orderCreatedMail,
  payment_confirmed: paymentConfirmedMail,
  payment_failed: paymentFailedMail,
  order_cancelled: orderCancelledMail,
  shipment_dispatched: shipmentDispatchedMail,
  out_for_delivery: outForDeliveryMail,
  delivered: deliveredMail,
  refund_initiated: refundInitiatedMail,
  refund_completed: refundCompletedMail,
  return_received: returnReceivedMail,
};

export const ORDER_MAIL_KINDS = Object.keys(ORDER_MAIL_BUILDERS) as OrderMailKind[];
