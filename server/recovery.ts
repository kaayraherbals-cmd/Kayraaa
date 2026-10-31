import { isUuid, type CartLineInput } from '../shared/cart.js';
import { isPermanentMailError } from '../shared/outbox.js';
import { CONSENT_TEXT_VERSION, SETTINGS_SELECT, assessLines, asRedeemResult, normaliseStats, preflightOutcome, settingsFromRow, worthSending, type PreflightResult, type RecoverySettings, type RecoveryStats, type RedeemResult } from '../shared/recovery.js';
import { recoveryMail } from '../shared/recoveryMail.js';
import { getSavedCart, loadVariantRecords } from './cart.js';
import { sendMail, type MailConfig } from './mail.js';
import { hashRestoreToken, isRestoreToken, newRestoreToken, oneClickUnsubscribeUrl, recoveryLinkConfig, restoreUrl, unsubscribePageUrl, type RecoveryLinks } from './recoveryToken.js';
import { rpc } from './rpc.js';
import { rest, type SupabaseConfig } from './supabase.js';

/**
 * Abandoned cart recovery worker (Phase 7).
 *
 * One pass = sync (close what no longer needs a reminder, attribute recovered orders, tidy) > detect (open cycles for newly
 * abandoned bags) > claim due reminders > for each: re-check EVERYTHING in the database, re-price the bag from live data, send, record.
 * Every database step is a single function call that locks its rows, so two passes running at once cannot send the same reminder:
 * (cycle, step) is unique, a claimed row is locked for 10 minutes, and the provider call carries a fixed idempotency key.
 * Counts only are returned and logged: never an address, a name, a cart line or a token.
 */
export interface RecoveryRunResult {
  status: 'ok' | 'disabled' | 'paused' | 'mail_not_configured';
  closed: number;
  attributed: number;
  purged: number;
  detected: number;
  claimed: number;
  sent: number;
  deferred: number;
  skipped: number;
  failed: number;
}

const EMPTY: RecoveryRunResult = { status: 'ok', closed: 0, attributed: 0, purged: 0, detected: 0, claimed: 0, sent: 0, deferred: 0, skipped: 0, failed: 0 };

export async function loadSettings(db: SupabaseConfig): Promise<RecoverySettings> {
  const r = await rest(db, `cart_recovery_settings?select=${SETTINGS_SELECT}&id=eq.true&limit=1`);
  if (!r.ok) throw new Error(`recovery settings ${r.status}`);
  const rows = (await r.json()) as Record<string, unknown>[];
  return settingsFromRow(rows[0]);
}

interface Claimed {
  id: string;
  cycle_id: string;
  step: number;
  member_id: string;
  attempts: number;
}

const senderLineFrom = (env: Record<string, string | undefined>): string | null => {
  const parts = [env.VITE_LEGAL_ENTITY_NAME?.trim(), env.VITE_CONTACT_ADDRESS?.trim()].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};

export async function runRecoveryJob(
  db: SupabaseConfig,
  mail: MailConfig | null,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<RecoveryRunResult> {
  const env = opts.env ?? process.env;
  const out: RecoveryRunResult = { ...EMPTY };

  // Housekeeping always runs (closing finished cycles, retention), even while sending is off.
  const sync = await rpc<{ closed?: number; attributed?: number; purged?: number }>(db, 'cart_recovery_sync', {});
  if (sync.ok && sync.data) {
    out.closed = Number(sync.data.closed) || 0;
    out.attributed = Number(sync.data.attributed) || 0;
    out.purged = Number(sync.data.purged) || 0;
  }

  const settings = await loadSettings(db);
  if (!settings.enabled) return { ...out, status: 'disabled' };
  if (settings.paused) return { ...out, status: 'paused' };

  // No email provider, or no safe link configuration: do not open cycles or claim anything. Reminders stay scheduled and unharmed.
  const links = recoveryLinkConfig(env);
  if (!mail || !links) return { ...out, status: 'mail_not_configured' };

  const det = await rpc<number>(db, 'cart_recovery_detect', { p_limit: settings.batchSize * 2 });
  if (det.ok) out.detected = Number(det.data) || 0;

  const claim = await rpc<Claimed[]>(db, 'cart_recovery_claim', { p_limit: settings.batchSize });
  if (!claim.ok) throw new Error('recovery claim failed');
  const rows = Array.isArray(claim.data) ? claim.data : [];
  out.claimed = rows.length;

  for (const row of rows) {
    try {
      await processOne(db, mail, links, settings, row, out, env, opts.fetchImpl);
    } catch (e) {
      // Only the error class is logged: error text can carry an address. The reminder goes back for another try.
      console.error('recovery row failed', e instanceof Error ? e.name : 'error');
      await rpc(db, 'cart_recovery_finish', { p_message: row.id, p_status: 'failed', p_reason: 'worker_error' }).catch(() => undefined);
      out.failed++;
    }
  }
  return out;
}

async function processOne(db: SupabaseConfig, mail: MailConfig, links: RecoveryLinks, settings: RecoverySettings, row: Claimed, out: RecoveryRunResult, env: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<void> {
  const finish = (status: 'sent' | 'failed' | 'skipped' | 'scheduled', reason?: string, provider?: string) =>
    rpc(db, 'cart_recovery_finish', { p_message: row.id, p_status: status, p_reason: reason ?? null, p_provider: provider ?? null });

  // 1. Everything the database can check: consent, suppression, cycle still open, bag unchanged, no order, no checkout in progress,
  //    no duplicate, sending limits, minimum gap. A "no" ends or postpones this reminder here.
  const pf = await rpc<PreflightResult>(db, 'cart_recovery_preflight', { p_message: row.id });
  if (!pf.ok || !pf.data) throw new Error('preflight failed');
  const stop = preflightOutcome(pf.data);
  if (stop) {
    await finish(stop.status, stop.reason);
    if (stop.status === 'scheduled') out.deferred++;
    else out.skipped++;
    return;
  }
  const p = pf.data;
  if (!p.email || !p.member_id || (p.step !== 1 && p.step !== 2 && p.step !== 3)) {
    await finish('skipped', 'bad_context');
    out.skipped++;
    return;
  }

  // 2. What the bag is worth NOW: live price, live stock, live product status. Nothing from when the bag was abandoned is used.
  const saved: CartLineInput[] = await getSavedCart(db, p.member_id);
  const assessed = assessLines(saved, await loadVariantRecords(db, saved.map((l) => l.variantId)));
  if (!worthSending(assessed)) {
    await finish('skipped', 'nothing_available');
    out.skipped++;
    return;
  }

  // 3. A fresh restore token (only its hash is stored), then the mail. The idempotency key is fixed per reminder, so a crash
  //    between "sent" and "recorded" cannot produce a second email within the provider's idempotency window.
  const t = newRestoreToken();
  const ttl = Number.isInteger(p.settings_ttl_hours) ? (p.settings_ttl_hours as number) : settings.tokenTtlHours;
  const issued = await rpc(db, 'cart_recovery_issue_token', { p_message: row.id, p_hash: t.hash, p_ttl_hours: ttl });
  if (!issued.ok) throw new Error('token issue failed');

  const built = recoveryMail({
    step: p.step,
    name: p.name,
    lines: assessed.lines,
    unavailable: assessed.unavailable,
    restoreUrl: restoreUrl(links, t.token),
    unsubscribeUrl: unsubscribePageUrl(links, p.member_id),
    oneClickUrl: oneClickUnsubscribeUrl(links, p.member_id),
    senderLine: senderLineFrom(env),
  });
  const res = await sendMail(db, mail, p.email, built, { idempotencyKey: `kaayra-${rowKey(row)}`, fetchImpl });
  if (res.status === 'sent') {
    await finish('sent', undefined, res.id ?? '');
    out.sent++;
  } else if (res.status === 'failed') {
    if (isPermanentMailError(res.error)) {
      await finish('skipped', `provider_${res.error}`.slice(0, 40));
      out.skipped++;
    } else {
      await finish('failed', res.error);
      out.failed++;
    }
  } else {
    await finish('skipped', res.reason);
    out.skipped++;
  }
}

const rowKey = (row: Claimed): string => `cart-recovery-${row.id}`;

// ---- Restore link ---------------------------------------------------------------------------------------------------------

/**
 * Checks a restore link for the signed-in customer (or for nobody). The saved bag itself is never copied or rebuilt: it is still the
 * customer's own saved bag, and the caller re-prices it live. This only proves the link is genuine, current and theirs.
 */
export async function redeemRestoreToken(db: SupabaseConfig, token: unknown, memberId: string | null): Promise<RedeemResult> {
  if (!isRestoreToken(token)) return 'invalid';
  const r = await rpc<{ result?: string }>(db, 'cart_recovery_redeem', { p_hash: hashRestoreToken(token), p_member: memberId && isUuid(memberId) ? memberId : null });
  if (!r.ok) throw new Error('redeem failed');
  return asRedeemResult(r.data?.result);
}

// ---- Consent and unsubscribe -------------------------------------------------------------------------------------------------

export interface MarketingState {
  cartReminders: boolean;
  /** True when this address is on the suppression list for a reason only the business can clear (bounce, complaint, admin). */
  blocked: boolean;
}

export async function getMarketingState(db: SupabaseConfig, memberId: string): Promise<MarketingState> {
  if (!isUuid(memberId)) return { cartReminders: false, blocked: false };
  const r = await rest(db, `marketing_preferences?select=cart_reminders&member_id=eq.${memberId}&limit=1`);
  if (!r.ok) throw new Error(`prefs ${r.status}`);
  const rows = (await r.json()) as { cart_reminders: boolean }[];
  return { cartReminders: rows[0]?.cart_reminders === true, blocked: false };
}

/** The customer's own choice, from the account page. Turning ON records the wording version and the time; turning OFF is a persistent suppression. */
export async function setCartReminders(db: SupabaseConfig, memberId: string, email: string, on: boolean): Promise<'ok' | 'suppressed'> {
  if (on) {
    const r = await rpc<{ result?: string }>(db, 'marketing_opt_in', { p_member: memberId, p_version: CONSENT_TEXT_VERSION, p_source: 'account_page' });
    if (!r.ok) throw new Error('opt in failed');
    return r.data?.result === 'suppressed' ? 'suppressed' : 'ok';
  }
  const r = await rpc(db, 'marketing_unsubscribe', { p_email: email, p_source: 'account' });
  if (!r.ok) throw new Error('opt out failed');
  return 'ok';
}

/** Unsubscribe from an email link. Always succeeds from the visitor's side; a member who no longer exists has nothing left to stop. */
export async function unsubscribeFromEmail(db: SupabaseConfig, memberId: string): Promise<void> {
  if (!isUuid(memberId)) return;
  const r = await rest(db, `members?select=email&id=eq.${memberId}&limit=1`);
  if (!r.ok) throw new Error(`member ${r.status}`);
  const rows = (await r.json()) as { email: string }[];
  if (!rows[0]) return;
  const u = await rpc(db, 'marketing_unsubscribe', { p_email: rows[0].email, p_source: 'recovery_email' });
  if (!u.ok) throw new Error('unsubscribe failed');
}

// ---- Dashboard reads -------------------------------------------------------------------------------------------------------

export async function loadStats(db: SupabaseConfig, fromIso: string, toIso: string): Promise<RecoveryStats> {
  const r = await rpc<unknown>(db, 'cart_recovery_stats', { p_from: fromIso, p_to: toIso });
  if (!r.ok) throw new Error('stats failed');
  return normaliseStats(r.data);
}
