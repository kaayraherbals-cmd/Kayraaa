import { formatRupees } from './cart.js';
import { escapeHtml, layout, oneLine, para, unsubscribeHeaders, type BuiltMail, type RecoveryMailKind } from './mailTemplates.js';
import type { RecoveryLine } from './recovery.js';

/**
 * Cart reminder emails (Phase 7). Pure functions.
 *
 * Rules these templates follow (and shared/recoveryMail.test.ts checks):
 *  - Subjects are fixed text. Nothing a customer typed is ever in a subject.
 *  - Marketing, so every mail has a visible unsubscribe link, the one-click List-Unsubscribe headers, and a sender line.
 *  - No urgency, no scarcity ("selling fast", "last chance"), no invented discounts, no price history, no health or medical claims.
 *  - Prices shown are today's prices from the database at send time, and the mail says they are confirmed again at checkout.
 *  - Nothing is promised as reserved: the shop only holds stock for an unpaid order for a short time, not for a bag.
 *  - The restore link carries a random token and nothing else: no email, no cart contents, no totals.
 */
export interface RecoveryMailParams {
  step: 1 | 2 | 3;
  name?: string | null;
  lines: RecoveryLine[];
  /** Names of saved items that can no longer be bought. Shown as a plain note, with no pressure. */
  unavailable: { productName: string; packSize: string }[];
  restoreUrl: string;
  unsubscribeUrl: string;
  oneClickUrl: string;
  /** Legal entity and postal address, from VITE_LEGAL_ENTITY_NAME / VITE_CONTACT_ADDRESS. Left out when not configured. */
  senderLine?: string | null;
}

export const RECOVERY_SUBJECTS: Record<1 | 2 | 3, string> = {
  1: 'Your Kaayra Herbals cart is waiting 🌿',
  2: 'Still thinking about your Kaayra picks?',
  3: 'Your saved Kaayra Herbals items',
};

const KIND: Record<1 | 2 | 3, RecoveryMailKind> = { 1: 'cart_recovery_1', 2: 'cart_recovery_2', 3: 'cart_recovery_3' };

const LEAD: Record<1 | 2 | 3, string[]> = {
  1: ['You left a few things in your Kaayra Herbals bag. They are still saved, so you can pick up where you stopped.'],
  2: ['A quick follow-up about the items in your bag. If you have a question about any of them, reply to this email and a member of our team will help.'],
  3: ['This is the last reminder about this bag. We will not email you about it again, and your items stay saved in your account.'],
};

const SHOWN_NOTE = 'Prices are today’s prices and are confirmed again at checkout. Items are not held for you until you place an order.';

function itemRows(lines: RecoveryLine[]): { html: string; text: string } {
  const html = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eee7d6;">${escapeHtml(oneLine(l.productName, 120))}<br><span style="color:#6b6b6b;font-size:13px;">${escapeHtml(oneLine(l.packSize, 40))} · Qty ${l.qty}${l.reduced ? ' (reduced to what we have in stock)' : ''}</span></td><td align="right" style="padding:6px 0;border-bottom:1px solid #eee7d6;white-space:nowrap;">${formatRupees(l.lineTotalPaise)}</td></tr>`,
    )
    .join('');
  const text = lines.map((l) => `- ${oneLine(l.productName, 120)}, ${oneLine(l.packSize, 40)}, qty ${l.qty}${l.reduced ? ' (reduced to what we have in stock)' : ''}: ${formatRupees(l.lineTotalPaise)}`).join('\n');
  return { html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;font-size:14px;">${html}</table>`, text };
}

export function recoveryMail(p: RecoveryMailParams): BuiltMail {
  const first = oneLine(p.name ?? '', 80).split(' ')[0];
  const helloHtml = first ? `Hello ${escapeHtml(first)},` : 'Hello,';
  const helloText = first ? `Hello ${first},` : 'Hello,';
  const rows = itemRows(p.lines);
  const gone = p.unavailable.length
    ? `${p.unavailable.length === 1 ? 'One saved item is' : `${p.unavailable.length} saved items are`} not available to order right now: ${p.unavailable.map((u) => `${oneLine(u.productName, 80)} ${oneLine(u.packSize, 30)}`.trim()).join(', ')}.`
    : '';
  const total = p.lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  const url = escapeHtml(p.restoreUrl);
  const unsub = escapeHtml(p.unsubscribeUrl);
  const sender = p.senderLine ? oneLine(p.senderLine, 300) : '';

  const bodyHtml =
    para(helloHtml) +
    LEAD[p.step].map(para).join('') +
    rows.html +
    para(`<strong>Items total: ${formatRupees(total)}</strong> <span style="color:#6b6b6b;">(tax included, delivery shown at checkout)</span>`) +
    (gone ? para(escapeHtml(gone)) : '') +
    para(`<a href="${url}" style="display:inline-block;padding:10px 18px;background:#173a2d;color:#f7f5ef;text-decoration:none;border-radius:6px;font-weight:bold;">Return to my bag</a>`) +
    para(`<span style="color:#6b6b6b;font-size:13px;">${escapeHtml(SHOWN_NOTE)} The link works for you when you are signed in to your account.</span>`);
  const footer =
    `You are receiving this because you asked for bag reminders in your Kaayra Herbals account. <a href="${unsub}" style="color:#6b6b6b;">Unsubscribe</a> at any time.` +
    (sender ? `<br>${escapeHtml(sender)}` : '');

  const text = [
    helloText,
    '',
    ...LEAD[p.step],
    '',
    rows.text,
    '',
    `Items total: ${formatRupees(total)} (tax included, delivery shown at checkout)`,
    ...(gone ? ['', gone] : []),
    '',
    `Return to my bag: ${p.restoreUrl}`,
    `${SHOWN_NOTE} The link works for you when you are signed in to your account.`,
    '',
    '--',
    `You are receiving this because you asked for bag reminders in your Kaayra Herbals account. Unsubscribe: ${p.unsubscribeUrl}`,
    ...(sender ? [sender] : []),
  ].join('\n');

  return { kind: KIND[p.step], subject: RECOVERY_SUBJECTS[p.step], html: layout(RECOVERY_SUBJECTS[p.step], bodyHtml, footer), text, headers: unsubscribeHeaders(p.oneClickUrl) };
}
