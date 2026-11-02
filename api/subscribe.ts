import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CONSENT_VERSION, validateSubscribe } from '../shared/subscribe.js';
import { clientIp, createLimiter, isLimited, originAllowed } from '../server/http.js';
import { rest, supabaseConfig, type SupabaseConfig } from '../server/supabase.js';
import { mailConfig, sendMail, type MailConfig } from '../server/mail.js';
import { launchConfirmMail, launchWelcomeMail } from '../shared/mailTemplates.js';
import { sendError } from '../server/errors.js';
import { findMemberByEmail } from '../server/members.js';
import { USER_COOKIE, verifyToken as verifyUserToken } from '../server/oauth.js';
import { MIN_SECRET_LENGTH } from '../server/session.js';
import { confirmUrl, emailHash, oneClickUrl, subscribeConfig, unsubscribeUrl, verifyToken, type SubscribeConfig } from '../server/subscribeToken.js';

/**
 * Launch list with double opt-in.
 *
 *   POST {email, name?, consent}      saves a PENDING row and sends one confirmation email. Nobody is "subscribed" yet.
 *   POST {action:'confirm', token}    from the /subscription page (a button click, so mail scanners that prefetch links
 *                                     cannot confirm by accident). pending -> confirmed, then the welcome mail, once.
 *   POST {action:'unsubscribe', token} the same page. Always succeeds, never reveals whether an address was on the list.
 *   POST ?u=<token>                   RFC 8058 one-click unsubscribe from a mail client; the signed token is the credential.
 *
 * The response to a sign-up is the same whether the address is new, pending, confirmed or unsubscribed, so the form cannot
 * be used to find out who is on the list. A confirmation is re-sent at most once every 15 minutes per address.
 */
const limited = createLimiter(10 * 60 * 1000, 5, 'subscribe');
const tokenLimited = createLimiter(10 * 60 * 1000, 60, 'subscribe_token');
const RESEND_AFTER_MS = 15 * 60 * 1000;

type Row = { id: string; status: string; name: string | null; confirmation_sent_at: string | null };

const eq = (email: string) => encodeURIComponent(email);

async function logConsent(db: SupabaseConfig, email: string, event: 'requested' | 'confirmed' | 'unsubscribed') {
  try {
    await rest(db, 'launch_consent_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ email_hash: emailHash(email), event, consent_text_version: CONSENT_VERSION }),
    });
  } catch {
    /* The log is evidence, not a dependency: it must never block a visitor. */
  }
}

async function findRow(db: SupabaseConfig, email: string): Promise<Row | null> {
  const r = await rest(db, `launch_subscribers?select=id,status,name,confirmation_sent_at&email=eq.${eq(email)}&limit=1`);
  if (!r.ok) throw new Error(`lookup ${r.status}`);
  const rows = (await r.json()) as Row[];
  return rows[0] ?? null;
}

/** Sends the confirmation. On a provider failure the resend timer is cleared so the visitor can try again straight away. */
async function sendConfirmation(db: SupabaseConfig, mcfg: MailConfig, sc: SubscribeConfig, email: string, name: string | null): Promise<boolean> {
  const mail = launchConfirmMail({ name, confirmUrl: confirmUrl(sc, email), unsubscribeUrl: unsubscribeUrl(sc, email), oneClickUrl: oneClickUrl(sc, email) });
  const result = await sendMail(db, mcfg, email, mail, { replyTo: mcfg.replyTo });
  if (result.status === 'sent') return true;
  await rest(db, `launch_subscribers?email=eq.${eq(email)}&status=neq.confirmed`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ confirmation_sent_at: null }) }).catch(() => undefined);
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 'FORM', 'KH-SYS-002');
  }

  const sc = subscribeConfig();
  const db = supabaseConfig();
  const mcfg = mailConfig();

  // One-click unsubscribe from a mail client. Authenticated by the signed token alone, so it needs no origin header.
  if (typeof req.query?.u === 'string') {
    if (await isLimited(tokenLimited, clientIp(req))) return sendError(res, 'FORM', 'KH-FORM-004');
    if (!sc || !db) return sendError(res, 'FORM', 'KH-FORM-002');
    const email = verifyToken(req.query.u, 'unsubscribe', sc.secret);
    if (!email) return res.status(400).json({ status: 'invalid_link', message: 'This link is not valid.' });
    try {
      await unsubscribe(db, email);
      return res.status(200).json({ status: 'unsubscribed' });
    } catch (e) {
      console.error('unsubscribe failed', e instanceof Error ? e.message : e);
      return sendError(res, 'FORM', 'KH-FORM-003', { message: 'We could not process that. Please try again.' });
    }
  }

  if (!originAllowed(req)) return sendError(res, 'FORM', 'KH-SYS-004');

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;

  // Confirm / unsubscribe from the /subscription page.
  if (body.action === 'confirm' || body.action === 'unsubscribe') {
    if (await isLimited(tokenLimited, clientIp(req))) {
      res.setHeader('Retry-After', '600');
      return sendError(res, 'FORM', 'KH-FORM-004');
    }
    if (!sc || !db) return sendError(res, 'FORM', 'KH-FORM-002', { status: 'unconfigured', message: 'This is not available yet. Please check back soon.' });
    const email = verifyToken(body.token, body.action, sc.secret);
    if (!email) {
      return res.status(400).json({ status: 'invalid_link', message: body.action === 'confirm' ? 'This confirmation link is not valid or has expired. Please sign up again from the homepage.' : 'This link is not valid.' });
    }
    try {
      if (body.action === 'unsubscribe') {
        await unsubscribe(db, email);
        return res.status(200).json({ status: 'unsubscribed' });
      }
      const r = await rest(db, `launch_subscribers?email=eq.${eq(email)}&status=eq.pending&select=name`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString(), unsubscribed_at: null }),
      });
      if (!r.ok) throw new Error(`confirm ${r.status}`);
      const changed = (await r.json()) as { name: string | null }[];
      if (changed.length === 1) {
        await logConsent(db, email, 'confirmed');
        // The welcome mail goes only on the pending -> confirmed change, so clicking twice never sends it twice.
        await sendMail(db, mcfg, email, launchWelcomeMail({ name: changed[0].name, unsubscribeUrl: unsubscribeUrl(sc, email), oneClickUrl: oneClickUrl(sc, email) }), { replyTo: mcfg?.replyTo });
        return res.status(200).json({ status: 'confirmed' });
      }
      const row = await findRow(db, email);
      if (row?.status === 'confirmed') return res.status(200).json({ status: 'already_confirmed' });
      if (row?.status === 'unsubscribed') return res.status(200).json({ status: 'was_unsubscribed', message: 'You have unsubscribed since. If you would like to hear from us again, sign up on the homepage.' });
      return res.status(400).json({ status: 'invalid_link', message: 'This confirmation link is not valid. Please sign up again from the homepage.' });
    } catch (e) {
      console.error('subscription action failed', e instanceof Error ? e.message : e);
      return sendError(res, 'FORM', 'KH-FORM-003', { message: 'We could not process that. Please try again.' });
    }
  }

  // A signed-in member joins in one click: no email or name is asked for. Their email was verified when they signed in, so the row is
  // confirmed at once and the one email they get says they have joined. The address always comes from the session, never from the request.
  if (body.action === 'join_member') {
    if (await isLimited(limited, clientIp(req))) {
      res.setHeader('Retry-After', '600');
      return sendError(res, 'FORM', 'KH-FORM-004');
    }
    if (body.consent !== true) return sendError(res, 'FORM', 'KH-FORM-001', { status: 'invalid', errors: { consent: 'Please confirm that you agree to receive launch updates.' } });
    if (!db || !sc || !mcfg) return sendError(res, 'FORM', 'KH-FORM-002', { status: 'unconfigured', message: 'Launch notifications are not available yet. Please check back soon.' });
    try {
      const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? '';
      const raw = secret.length >= MIN_SECRET_LENGTH ? verifyUserToken<{ email: string }>('user', req.cookies?.[USER_COOKIE], secret) : null;
      const member = raw && typeof raw.email === 'string' ? await findMemberByEmail(db, raw.email) : null;
      if (!member) return res.status(401).json({ status: 'signin_required', message: 'Please sign in to join the launch list.' });
      const email = member.email;
      const name = member.name ?? null;
      const now = new Date().toISOString();
      const fields = { status: 'confirmed', consent_given: true, consent_text_version: CONSENT_VERSION, consented_at: now, confirmed_at: now, unsubscribed_at: null, optin_method: 'member', ...(name ? { name } : {}) };
      let joined = false;
      const ins = await rest(db, 'launch_subscribers', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ email, source: 'website', ...fields }) });
      if (ins.status === 201 || ins.status === 204) {
        joined = true;
      } else if (ins.status === 409) {
        const row = await findRow(db, email);
        if (!row) throw new Error('conflict without row');
        if (row.status === 'confirmed') return res.status(200).json({ status: 'already_joined' });
        const upd = await rest(db, `launch_subscribers?id=eq.${row.id}&status=neq.confirmed`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fields) });
        if (!upd.ok) throw new Error(`join ${upd.status}`);
        joined = true;
      } else {
        throw new Error(`insert ${ins.status}`);
      }
      if (joined) {
        await logConsent(db, email, 'requested');
        await logConsent(db, email, 'confirmed');
        // A failed email never undoes the sign-up: the member is on the list and is told so on screen as well.
        await sendMail(db, mcfg, email, launchWelcomeMail({ name, joined: true, unsubscribeUrl: unsubscribeUrl(sc, email), oneClickUrl: oneClickUrl(sc, email) }), { replyTo: mcfg.replyTo });
      }
      return res.status(200).json({ status: 'joined' });
    } catch (e) {
      console.error('member join failed', e instanceof Error ? e.message : e);
      return sendError(res, 'FORM', 'KH-FORM-003', { message: 'We could not save that. Please try again.' });
    }
  }

  // New sign-up request.
  if (await isLimited(limited, clientIp(req))) {
    res.setHeader('Retry-After', '600');
    return sendError(res, 'FORM', 'KH-FORM-004');
  }

  const parsed = validateSubscribe(body);
  if (!parsed.ok) return sendError(res, 'FORM', 'KH-FORM-001', { status: 'invalid', errors: parsed.errors });

  // Honeypot: pretend success so bots learn nothing, store nothing.
  if (parsed.value.website) return res.status(200).json({ status: 'ok' });

  // Without the signing secret, a real https site address and a working mail provider a confirmation cannot be delivered,
  // so nothing is stored (no "pending" rows that nobody can ever confirm).
  if (!db || !sc || !mcfg) {
    return sendError(res, 'FORM', 'KH-FORM-002', { status: 'unconfigured', message: 'Launch notifications are not available yet. Please check back soon.' });
  }

  const { email } = parsed.value;
  const name = parsed.value.name ?? null;
  const now = new Date().toISOString();
  try {
    const ins = await rest(db, 'launch_subscribers', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ email, name, consent_given: true, consent_text_version: CONSENT_VERSION, source: 'website', status: 'pending', optin_method: 'double', confirmation_sent_at: now }),
    });
    let send = false;
    if (ins.status === 201 || ins.status === 204) {
      send = true;
    } else if (ins.status === 409) {
      const row = await findRow(db, email);
      if (!row) throw new Error('conflict without row');
      const recent = row.confirmation_sent_at ? Date.now() - Date.parse(row.confirmation_sent_at) < RESEND_AFTER_MS : false;
      if (row.status !== 'confirmed' && !recent) {
        // Pending (confirmation lost or expired) or unsubscribed (asking again): a fresh consent record and a fresh email.
        const upd = await rest(db, `launch_subscribers?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'pending', consent_given: true, consent_text_version: CONSENT_VERSION, consented_at: now, confirmation_sent_at: now, unsubscribed_at: null, optin_method: 'double', ...(name ? { name } : {}) }),
        });
        if (!upd.ok) throw new Error(`refresh ${upd.status}`);
        send = true;
      }
    } else {
      throw new Error(`insert ${ins.status}`);
    }
    if (send) {
      await logConsent(db, email, 'requested');
      const ok = await sendConfirmation(db, mcfg, sc, email, name);
      if (!ok) return sendError(res, 'FORM', 'KH-FORM-003', { message: 'We could not send the confirmation email. Please try again in a moment.' });
    }
    // Identical answer for every case (new, repeated, already confirmed): the form never reveals who is on the list.
    return res.status(200).json({ status: 'ok' });
  } catch (e) {
    console.error('subscribe failed', e instanceof Error ? e.message : e);
    return sendError(res, 'FORM', 'KH-FORM-003', { message: 'We could not save your details. Please try again.' });
  }
}

async function unsubscribe(db: SupabaseConfig, email: string): Promise<void> {
  const r = await rest(db, `launch_subscribers?email=eq.${eq(email)}&status=neq.unsubscribed&select=id`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`unsubscribe ${r.status}`);
  const changed = (await r.json()) as unknown[];
  if (changed.length > 0) await logConsent(db, email, 'unsubscribed');
}
