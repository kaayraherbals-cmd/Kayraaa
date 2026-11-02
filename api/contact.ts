import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateContact } from '../shared/contact.js';
import { clientIp, createLimiter, isLimited, originAllowed } from '../server/http.js';
import { rest, supabaseConfig } from '../server/supabase.js';
import { mailConfig, sendMail } from '../server/mail.js';
import { contactAutoReplyMail, contactOwnerMail } from '../shared/mailTemplates.js';
import { sendError } from '../server/errors.js';

const limited = createLimiter(10 * 60 * 1000, 3, 'contact');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 'FORM', 'KH-SYS-002');
  }
  if (!originAllowed(req)) return sendError(res, 'FORM', 'KH-SYS-004');
  if (await isLimited(limited, clientIp(req))) {
    res.setHeader('Retry-After', '600');
    return sendError(res, 'FORM', 'KH-FORM-004', { message: 'Too many messages. Please try again later.' });
  }

  const parsed = validateContact(req.body);
  if (!parsed.ok) return sendError(res, 'FORM', 'KH-FORM-001', { status: 'invalid', errors: parsed.errors });
  if (parsed.value.website) return res.status(200).json({ status: 'ok' });

  const cfg = supabaseConfig();
  if (!cfg) {
    return sendError(res, 'FORM', 'KH-FORM-002', { status: 'unconfigured', message: 'The contact form is not available yet. Nothing has been sent.' });
  }

  try {
    const r = await rest(cfg, 'contact_messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ name: parsed.value.name, email: parsed.value.email, message: parsed.value.message }),
    });
    if (r.status === 201 || r.status === 204) {
      // The message is saved. Mail is best effort and can never turn a saved message into an error.
      const mcfg = mailConfig();
      if (mcfg) {
        const { name, email, message } = parsed.value;
        const jobs: Promise<unknown>[] = [];
        if (mcfg.ownerTo) jobs.push(sendMail(cfg, mcfg, mcfg.ownerTo, contactOwnerMail({ name, email, message })));
        if (mcfg.autoReply) jobs.push(sendMail(cfg, mcfg, email, contactAutoReplyMail({ name }), { replyTo: mcfg.replyTo }));
        await Promise.allSettled(jobs);
      }
      return res.status(200).json({ status: 'ok' });
    }
    console.error('Supabase contact insert failed', r.status);
    return sendError(res, 'FORM', 'KH-FORM-003', { message: 'We could not send your message. Please try again.' });
  } catch (e) {
    console.error('Supabase contact error', e instanceof Error ? e.message : e);
    return sendError(res, 'FORM', 'KH-FORM-003', { message: 'We could not send your message. Please try again.' });
  }
}
