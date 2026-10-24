import type { VercelRequest, VercelResponse } from '@vercel/node';
import { makeIssueRef } from '../shared/errors.js';
import { validateIssue } from '../shared/issues.js';
import { sendError } from '../server/errors.js';
import { clientIp, createLimiter, isLimited, originAllowed } from '../server/http.js';
import { rest, supabaseConfig } from '../server/supabase.js';
import { mailConfig, sendMail } from '../server/mail.js';
import { issueOwnerMail } from '../shared/mailTemplates.js';

const limited = createLimiter(10 * 60 * 1000, 5, 'issues');

/** Public "Report a problem" endpoint. Stores the report; the owner reads it in Admin > Issues. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 'ISSUE', 'KH-SYS-002');
  }
  if (!originAllowed(req)) return sendError(res, 'ISSUE', 'KH-SYS-004');
  if (await isLimited(limited, clientIp(req))) {
    res.setHeader('Retry-After', '600');
    return sendError(res, 'ISSUE', 'KH-ISSUE-002');
  }

  const parsed = validateIssue(req.body);
  if (!parsed.ok) return sendError(res, 'ISSUE', 'KH-ISSUE-001', { errors: parsed.errors });
  if (parsed.value.website) return res.status(200).json({ status: 'ok', reportRef: makeIssueRef() });

  const cfg = supabaseConfig();
  if (!cfg) return sendError(res, 'ISSUE', 'KH-ISSUE-003');

  const v = parsed.value;
  const reportRef = makeIssueRef();
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 200) || null;
  try {
    const r = await rest(cfg, 'issues', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ref: reportRef,
        category: v.category,
        summary: v.summary,
        details: v.details,
        error_code: v.errorCode || null,
        error_ref: v.ref || null,
        page: v.page || null,
        contact_email: v.email && v.consent ? v.email : null,
        user_agent: userAgent,
      }),
    });
    if (r.status === 201 || r.status === 204) {
      const mcfg = mailConfig();
      if (mcfg?.ownerTo) {
        await sendMail(cfg, mcfg, mcfg.ownerTo, issueOwnerMail({ ref: reportRef, category: v.category, summary: v.summary, errorCode: v.errorCode || null, contactEmail: v.email && v.consent ? v.email : null }));
      }
      return res.status(200).json({ status: 'ok', reportRef });
    }
    console.error('Supabase issue insert failed', r.status);
    return sendError(res, 'ISSUE', 'KH-ISSUE-004');
  } catch (e) {
    console.error('Supabase issue error', e instanceof Error ? e.message : e);
    return sendError(res, 'ISSUE', 'KH-ISSUE-004');
  }
}
