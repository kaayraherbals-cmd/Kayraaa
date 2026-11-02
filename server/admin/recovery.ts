import { METRIC_DEFINITIONS, maskEmail, settingsFromRow, SETTINGS_SELECT, validateSettingsUpdate } from '../../shared/recovery.js';
import { loadStats } from '../recovery.js';
import { recoveryLinkConfig } from '../recoveryToken.js';
import { mailConfig } from '../mail.js';
import { rest } from '../supabase.js';
import { need, type AdminCtx } from './ctx.js';

/**
 * Cart recovery (owner only). Reading needs recovery.read, changing settings needs recovery.manage; today only owners hold either.
 *
 *   recovery-overview  GET    settings, readiness, the numbers for a period, open recovery cycles (masked email), recent failures
 *   recovery-settings  PATCH  validated change; every change is written to the audit log with the old and new values
 *
 * There is deliberately NO action here that sends an email, edits a cart, issues a discount, or touches an order, a payment or stock.
 * The dashboard can only switch recovery on or off, pause it, and tune timing and limits. Customer data shown is minimal: a masked
 * address, item count, timings. Never a name, a full address, a cart price or a token.
 */
const PERIODS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function handleRecovery(ctx: AdminCtx, action: string): Promise<boolean> {
  if (!action.startsWith('recovery')) return false;
  const { req, cfg, json, audit } = ctx;
  const method = req.method ?? 'GET';
  const db = cfg.db;

  if (action === 'recovery-overview' && method === 'GET') {
    if (!(await need(ctx, 'recovery.read'))) return true;
    const key = String(req.query.period ?? '7d');
    const days = PERIODS[key] ?? 7;
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const [sr, cr, fr] = await Promise.all([
      rest(db, `cart_recovery_settings?select=${SETTINGS_SELECT}&id=eq.true&limit=1`),
      rest(db, 'cart_recovery_cycles?select=id,created_at,abandoned_at,line_count,status,members(email),cart_recovery_messages(step,status,due_at,sent_at,clicked_at)&status=eq.open&order=created_at.desc&limit=50'),
      rest(db, 'cart_recovery_messages?select=id,step,status,reason,attempts,updated_at&status=in.(failed,skipped)&order=updated_at.desc&limit=25'),
    ]);
    if (!sr.ok || !cr.ok || !fr.ok) throw new Error(`recovery ${sr.status}/${cr.status}/${fr.status}`);
    const settings = settingsFromRow(((await sr.json()) as Record<string, unknown>[])[0]);
    const cycles = ((await cr.json()) as { id: string; created_at: string; abandoned_at: string; line_count: number; status: string; members: { email: string } | { email: string }[] | null; cart_recovery_messages: unknown[] }[]).map((c) => {
      const m = Array.isArray(c.members) ? c.members[0] : c.members;
      return { id: c.id, customer: maskEmail(m?.email), abandonedAt: c.abandoned_at, items: c.line_count, status: c.status, messages: c.cart_recovery_messages };
    });
    const stats = await loadStats(db, from.toISOString(), to.toISOString());
    json(200, {
      status: 'ok',
      settings,
      readiness: { emailProvider: mailConfig() !== null, links: recoveryLinkConfig() !== null },
      period: Object.keys(PERIODS).includes(key) ? key : '7d',
      stats,
      definitions: METRIC_DEFINITIONS,
      cycles,
      failures: await fr.json(),
    });
    return true;
  }

  if (action === 'recovery-settings' && method === 'PATCH') {
    if (!(await need(ctx, 'recovery.manage'))) return true;
    const parsed = validateSettingsUpdate(req.body);
    if (!parsed.ok) {
      json(400, { status: 'error', message: 'Those settings are not valid.', problems: parsed.errors });
      return true;
    }
    const before = await rest(db, `cart_recovery_settings?select=${SETTINGS_SELECT}&id=eq.true&limit=1`);
    if (!before.ok) throw new Error(`recovery settings ${before.status}`);
    const old = settingsFromRow(((await before.json()) as Record<string, unknown>[])[0]);
    const r = await rest(db, 'cart_recovery_settings?id=eq.true', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...parsed.patch, updated_by: ctx.email, updated_at: new Date().toISOString() }) });
    if (!r.ok) throw new Error(`recovery settings save ${r.status}`);
    await audit('recovery_settings_changed', { from: old, to: parsed.changed });
    json(200, { status: 'ok' });
    return true;
  }

  json(404, { status: 'error', message: 'Not found.' });
  return true;
}
