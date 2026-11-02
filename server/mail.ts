import { randomUUID } from 'node:crypto';
import type { BuiltMail } from '../shared/mailTemplates.js';
import { rest, type SupabaseConfig } from './supabase.js';

/**
 * Outgoing email through Resend (https://resend.com), server only.
 *
 * Design rules:
 *  - Mail never breaks a form. sendMail() never throws; a failure is logged (without addresses) and recorded in
 *    email_outbox so an owner can see it. The visitor's message is already saved before any mail is attempted.
 *  - Nothing is sent unless RESEND_API_KEY is set, so the site is safe before email is configured ("skipped").
 *  - The outbox stores the recipient, kind and result, never the body.
 *  - A request is cut off after 5 seconds so a slow provider cannot hold a serverless function open.
 */

export interface MailConfig {
  apiKey: string;
  from: string;
  /** Where internal notifications go. */
  ownerTo: string | null;
  /** Reply-To on mails sent to visitors, so a reply reaches a person instead of the no-reply address. */
  replyTo: string | null;
  /** Send the visitor an automatic receipt for contact messages. */
  autoReply: boolean;
}

const DEFAULT_FROM = 'Kaayra Herbals <no-reply@kaayraherbals.com>';
const ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;.]+(\.[^\s@<>,;.]+)+$/;
const FROM_RE = /^(?:[^<>\r\n]{1,80}\s)?<?[^\s@<>,;]+@[^\s@<>,;.]+(?:\.[^\s@<>,;.]+)+>?$/;

export function isMailAddress(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 254 && ADDRESS_RE.test(s);
}

export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;

  const fromRaw = env.MAIL_FROM?.trim() || DEFAULT_FROM;
  const from = FROM_RE.test(fromRaw) ? fromRaw : DEFAULT_FROM;

  const firstAdmin = (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).find(Boolean);
  const ownerRaw = env.MAIL_OWNER_TO?.trim().toLowerCase() || firstAdmin || '';
  const ownerTo = isMailAddress(ownerRaw) ? ownerRaw : null;

  const replyRaw = env.MAIL_REPLY_TO?.trim().toLowerCase() || ownerTo || '';
  const replyTo = isMailAddress(replyRaw) ? replyRaw : null;

  const autoReply = (env.MAIL_AUTOREPLY ?? 'on').trim().toLowerCase() !== 'off';
  return { apiKey, from, ownerTo, replyTo, autoReply };
}

export type MailResult = { status: 'sent'; id: string | null } | { status: 'failed'; error: string } | { status: 'skipped'; reason: string };

export async function sendMail(
  db: SupabaseConfig | null,
  cfg: MailConfig | null,
  to: string,
  mail: BuiltMail,
  opts: { replyTo?: string | null; fetchImpl?: typeof fetch; idempotencyKey?: string } = {},
): Promise<MailResult> {
  let result: MailResult;
  if (!cfg) result = { status: 'skipped', reason: 'not_configured' };
  else if (!isMailAddress(to)) result = { status: 'skipped', reason: 'bad_recipient' };
  else result = await deliver(cfg, to, mail, opts.replyTo ?? mail.replyTo ?? null, opts.fetchImpl ?? fetch, opts.idempotencyKey);

  if (result.status === 'failed') console.error(`mail ${mail.kind} failed: ${result.error}`);
  // Skipped mails are not recorded: before email is set up there is nothing to show.
  if (db && result.status !== 'skipped') await record(db, to, mail, result);
  return result;
}

async function deliver(cfg: MailConfig, to: string, mail: BuiltMail, replyTo: string | null, f: typeof fetch, idempotencyKey?: string): Promise<MailResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const body: Record<string, unknown> = { from: cfg.from, to: [to], subject: mail.subject, html: mail.html, text: mail.text };
    if (replyTo && isMailAddress(replyTo)) body.reply_to = replyTo;
    if (mail.headers) body.headers = mail.headers;
    const r = await f('https://api.resend.com/emails', {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey ?? randomUUID() },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const j = (await r.json().catch(() => null)) as { id?: unknown } | null;
      return { status: 'sent', id: typeof j?.id === 'string' ? j.id.slice(0, 80) : null };
    }
    // Only the status code is kept: the response can echo addresses.
    return { status: 'failed', error: `http_${r.status}` };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

async function record(db: SupabaseConfig, to: string, mail: BuiltMail, result: Exclude<MailResult, { status: 'skipped' }>): Promise<void> {
  try {
    await rest(db, 'email_outbox', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        kind: mail.kind,
        to_email: to.toLowerCase(),
        status: result.status,
        provider_id: result.status === 'sent' ? result.id : null,
        error: result.status === 'failed' ? result.error : null,
      }),
    });
  } catch {
    // The outbox is a convenience. Losing a row must never affect a visitor.
  }
}
