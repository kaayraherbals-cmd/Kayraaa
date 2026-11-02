/**
 * Email templates. Pure functions: no network, no environment, easy to test.
 *
 * Rules every template follows:
 *  - Subjects are fixed text. Nothing a visitor typed ever goes into a subject or a header (blocks header injection).
 *  - Anything a visitor typed that appears in the body is HTML-escaped (HTML part) or left as plain text (text part).
 *  - No product, price, health or launch-date claims. The launch mail says only that we will write when Kaayra opens.
 *  - Every mail has a plain-text part, because many clients and spam filters prefer it.
 */

export type OrderMailKind = 'order_created' | 'payment_confirmed' | 'payment_failed' | 'order_cancelled' | 'shipment_dispatched' | 'out_for_delivery' | 'delivered' | 'refund_initiated' | 'refund_completed' | 'return_received';
export type RecoveryMailKind = 'cart_recovery_1' | 'cart_recovery_2' | 'cart_recovery_3';
export type MailKind = 'contact_owner' | 'contact_autoreply' | 'launch_confirm' | 'launch_welcome' | 'issue_owner' | OrderMailKind | RecoveryMailKind;

export interface BuiltMail {
  kind: MailKind;
  subject: string;
  html: string;
  text: string;
  /** Where a reply should go (set only when the visitor's address is the right target). */
  replyTo?: string;
  /** Extra headers (List-Unsubscribe). Values are built by the server from signed links, never from visitor input. */
  headers?: Record<string, string>;
}

const BRAND = 'Kaayra Herbals';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip CR/LF and control characters so a value can never break a header or a single-line field. */
export function oneLine(s: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function layout(title: string, bodyHtml: string, footer: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f6f1e7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #e4dcc9;border-radius:8px;">
<tr><td style="padding:28px 32px 8px 32px;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#173a2d;letter-spacing:0.3px;">${BRAND}</td></tr>
<tr><td style="padding:8px 32px 28px 32px;font-family:Manrope,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#2b2b2b;">${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px 24px 32px;border-top:1px solid #e4dcc9;font-family:Manrope,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:#6b6b6b;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export function para(s: string): string {
  return `<p style="margin:0 0 14px 0;">${s}</p>`;
}

/** Notification to the owner: a visitor sent a message. Reply goes straight to the visitor. */
export function contactOwnerMail(p: { name: string; email: string; message: string }): BuiltMail {
  const name = oneLine(p.name, 80);
  const email = oneLine(p.email, 254);
  const message = p.message.trim();
  const html = layout(
    'New contact message',
    para('A visitor sent a message through the website contact form.') +
      para(`<strong>Name:</strong> ${escapeHtml(name)}<br><strong>Email:</strong> ${escapeHtml(email)}`) +
      `<div style="margin:0 0 14px 0;padding:12px 14px;background:#f6f1e7;border-radius:6px;white-space:pre-wrap;">${escapeHtml(message)}</div>` +
      para('Reply to this email to answer them directly. It is also saved in Admin &gt; Messages.'),
    'Internal notification. Do not forward this mail: it contains a visitor’s personal details.',
  );
  const text = `A visitor sent a message through the website contact form.\n\nName: ${name}\nEmail: ${email}\n\n${message}\n\nReply to this email to answer them directly. It is also saved in Admin > Messages.`;
  return { kind: 'contact_owner', subject: 'New website message', html, text, replyTo: email };
}

/** Receipt for the visitor. Says only that the message arrived. No promise of a reply time, no claims. */
export function contactAutoReplyMail(p: { name: string }): BuiltMail {
  const first = oneLine(p.name, 80).split(' ')[0] || 'there';
  const html = layout(
    'We received your message',
    para(`Hello ${escapeHtml(first)},`) +
      para('Thank you for writing to Kaayra Herbals. This is a quick note to confirm that your message reached us.') +
      para('A member of our team will read it and reply by email. If you need to add something, just reply to this message.') +
      para('This is not medical advice. If you have a health concern, please speak to a qualified doctor.'),
    'You are receiving this one-time confirmation because this address was entered on the Kaayra Herbals contact form. If that was not you, you can ignore this email.',
  );
  const text = `Hello ${first},\n\nThank you for writing to Kaayra Herbals. This is a quick note to confirm that your message reached us.\n\nA member of our team will read it and reply by email. If you need to add something, just reply to this message.\n\nThis is not medical advice. If you have a health concern, please speak to a qualified doctor.\n\n--\nYou are receiving this one-time confirmation because this address was entered on the Kaayra Herbals contact form. If that was not you, you can ignore this email.`;
  return { kind: 'contact_autoreply', subject: 'We received your message', html, text };
}

/** Headers that let a mail client offer its own Unsubscribe button (RFC 2369 and RFC 8058 one-click). */
export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

function firstNameOf(name?: string | null) {
  const first = oneLine(name ?? '', 80).split(' ')[0];
  return { html: first ? `Hello ${escapeHtml(first)},` : 'Hello,', text: first ? `Hello ${first},` : 'Hello,' };
}

/** Step one of double opt-in. Nothing is stored as subscribed until the person opens the link and confirms. */
export function launchConfirmMail(p: { name?: string | null; confirmUrl: string; unsubscribeUrl: string; oneClickUrl?: string }): BuiltMail {
  const hello = firstNameOf(p.name);
  const url = escapeHtml(p.confirmUrl);
  const unsub = escapeHtml(p.unsubscribeUrl);
  const html = layout(
    'Confirm your email',
    para(hello.html) +
      para('Someone, hopefully you, asked to hear when Kaayra Herbals opens. Please confirm that this is your address. Until you do, we will not write to you again.') +
      para(`<a href="${url}" style="color:#173a2d;font-weight:bold;">Confirm my email address</a>`) +
      para('This link works for 7 days. If you did not ask for this, ignore this email and nothing will happen.'),
    `You received this because this address was entered on the Kaayra Herbals launch list. <a href="${unsub}" style="color:#6b6b6b;">Unsubscribe</a>.`,
  );
  const text = `${hello.text}\n\nSomeone, hopefully you, asked to hear when Kaayra Herbals opens. Please confirm that this is your address. Until you do, we will not write to you again.\n\nConfirm: ${p.confirmUrl}\n\nThis link works for 7 days. If you did not ask for this, ignore this email and nothing will happen.\n\n--\nYou received this because this address was entered on the Kaayra Herbals launch list. Unsubscribe: ${p.unsubscribeUrl}`;
  return { kind: 'launch_confirm', subject: 'Please confirm your email for Kaayra Herbals', html, text, ...(p.oneClickUrl ? { headers: unsubscribeHeaders(p.oneClickUrl) } : {}) };
}

/** Sent once, after the person confirmed. */
export function launchWelcomeMail(p: { name?: string | null; unsubscribeUrl?: string; oneClickUrl?: string; joined?: boolean }): BuiltMail {
  const thanks = p.joined ? 'Thank you for joining.' : 'Thank you for confirming.';
  const hello = firstNameOf(p.name);
  const leaveHtml = p.unsubscribeUrl ? `<a href="${escapeHtml(p.unsubscribeUrl)}" style="color:#6b6b6b;">Unsubscribe</a>` : 'reply and tell us';
  const leaveHtmlBody = p.unsubscribeUrl ? `<a href="${escapeHtml(p.unsubscribeUrl)}" style="color:#173a2d;">unsubscribe here</a>` : 'reply to this email and say so';
  const html = layout(
    'You are on the list',
    para(hello.html) +
      para(thanks + ' You are on the Kaayra Herbals list, and we will write to you once, when we launch.') +
      para(`Until then we will not send anything else. If you would like to be removed at any time, ${leaveHtmlBody}.`),
    `You are receiving this because you confirmed this address for the Kaayra Herbals launch list. To stop, ${leaveHtml}.`,
  );
  const leaveText = p.unsubscribeUrl ? `Unsubscribe: ${p.unsubscribeUrl}` : 'reply and tell us';
  const text = `${hello.text}\n\n${thanks} You are on the Kaayra Herbals list, and we will write to you once, when we launch.\n\nUntil then we will not send anything else. If you would like to be removed at any time, ${p.unsubscribeUrl ? 'use this link' : 'reply to this email and say so'}.\n\n--\nYou are receiving this because you confirmed this address for the Kaayra Herbals launch list. To stop, ${leaveText}.`;
  return { kind: 'launch_welcome', subject: 'You are on the Kaayra Herbals list', html, text, ...(p.oneClickUrl ? { headers: unsubscribeHeaders(p.oneClickUrl) } : {}) };
}

/** Notification to the owner: a problem report arrived. Reply-to is set only when the visitor agreed to be contacted. */
export function issueOwnerMail(p: { ref: string; category: string; summary: string; errorCode?: string | null; contactEmail?: string | null }): BuiltMail {
  const ref = oneLine(p.ref, 40);
  const category = oneLine(p.category, 40);
  const summary = oneLine(p.summary, 200);
  const code = p.errorCode ? oneLine(p.errorCode, 30) : '';
  const contact = p.contactEmail ? oneLine(p.contactEmail, 254) : '';
  const html = layout(
    'New problem report',
    para('A visitor reported a problem.') +
      para(`<strong>Reference:</strong> ${escapeHtml(ref)}<br><strong>Category:</strong> ${escapeHtml(category)}${code ? `<br><strong>Error code:</strong> ${escapeHtml(code)}` : ''}<br><strong>Summary:</strong> ${escapeHtml(summary)}${contact ? `<br><strong>Contact:</strong> ${escapeHtml(contact)}` : '<br><strong>Contact:</strong> none given'}`) +
      para('Full details are in Admin &gt; Issues.'),
    'Internal notification.',
  );
  const text = `A visitor reported a problem.\n\nReference: ${ref}\nCategory: ${category}${code ? `\nError code: ${code}` : ''}\nSummary: ${summary}\nContact: ${contact || 'none given'}\n\nFull details are in Admin > Issues.`;
  return { kind: 'issue_owner', subject: 'New problem report', html, text, replyTo: contact || undefined };
}
