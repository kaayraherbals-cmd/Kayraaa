import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, formatRate, formatRevenue, type RecoverySettings, type RecoveryStats } from '../../shared/recovery';
import { api, errorText, useMe, when } from '../lib/adminKit';

interface Cycle {
  id: string;
  customer: string;
  abandonedAt: string;
  items: number;
  status: string;
  messages: { step: number; status: string; due_at: string; sent_at: string | null; clicked_at: string | null }[];
}
interface Failure {
  id: string;
  step: number;
  status: string;
  reason: string | null;
  attempts: number;
  updated_at: string;
}
interface Overview {
  settings: RecoverySettings;
  readiness: { emailProvider: boolean; links: boolean };
  period: string;
  stats: RecoveryStats;
  definitions: Record<string, string>;
  cycles: Cycle[];
  failures: Failure[];
}

const PERIODS = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']] as const;
const num = (v: string): number => (v.trim() === '' ? NaN : Number(v));

/**
 * Cart recovery (owner only). Existing admin components and classes only. It can switch recovery on or off, pause it and tune timing and
 * limits. It cannot send an email, edit a bag, create a discount or touch an order, payment or stock.
 */
export default function AdminRecovery({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const canManage = me.can('recovery.manage');
  const [period, setPeriod] = useState<string>('7d');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ inactivity: '', d1: '', d2: '', d3: '', perCycle: '', perMember: '', batch: '' });

  const load = useCallback(async () => {
    const r = await api<Overview>(`recovery-overview?period=${period}`);
    if (r.status === 401) return onExpired();
    if (!r.ok || !r.data) return setError(errorText(r, 'Could not load cart recovery.'));
    setError('');
    setData(r.data);
    const s = r.data.settings;
    setForm({ inactivity: String(s.inactivityMinutes), d1: String(s.stepDelaysMinutes[0]), d2: String(s.stepDelaysMinutes[1]), d3: String(s.stepDelaysMinutes[2]), perCycle: String(s.maxMessagesPerCycle), perMember: String(s.maxPerMember7d), batch: String(s.batchSize) });
  }, [period, onExpired]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setNotice('');
    setError('');
    const r = await api('recovery-settings', { method: 'PATCH', body });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (!r.ok) return setError(errorText(r, 'Could not save.'));
    setNotice(done);
    void load();
  }

  const s = data?.settings ?? DEFAULT_SETTINGS;
  const st = data?.stats;
  const ready = data ? data.readiness.emailProvider && data.readiness.links : false;
  const rows: [string, string, string][] = st
    ? [
        ['Abandoned carts', String(st.abandoned_carts), 'abandoned_carts'],
        ['Eligible abandoned carts', String(st.eligible_carts), 'eligible_carts'],
        ['Reminder emails queued', String(st.emails_queued), 'emails_queued'],
        ['Reminder emails sent', String(st.emails_sent), 'emails_sent'],
        ['Delivery failures', String(st.delivery_failures), 'delivery_failures'],
        ['Link clicks', String(st.clicks), 'clicks'],
        ['Recovered carts', String(st.recovered_carts), 'recovered_orders'],
        ['Recovered orders', String(st.recovered_orders), 'recovered_orders'],
        ['Attributed revenue', formatRevenue(st.attributed_revenue_paise), 'attributed_revenue'],
        ['Recovery conversion rate', formatRate(st.conversion_rate), 'conversion_rate'],
        ['Unsubscribe rate', formatRate(st.unsubscribe_rate), 'unsubscribe_rate'],
      ]
    : [];

  function saveTiming() {
    const body = { inactivityMinutes: num(form.inactivity), stepDelaysMinutes: [num(form.d1), num(form.d2), num(form.d3)], maxMessagesPerCycle: num(form.perCycle), maxPerMember7d: num(form.perMember), batchSize: num(form.batch) };
    void save(body, 'Timing and limits saved.');
  }

  return (
    <section aria-labelledby="rec-title">
      <div className="admin-toolbar">
        <h1 id="rec-title">Cart recovery</h1>
      </div>
      <p className="field-hint">
        Reminder emails go only to signed-in customers who switched reminders on in their account, at most three per abandoned bag, and stop the moment they buy, change the bag or unsubscribe. No discounts are created here.
      </p>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {notice && <p className="form-status form-status--info" role="status">{notice}</p>}
      {!data && !error && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          <h2>Status</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Cart recovery status</caption>
              <tbody>
                <tr><th scope="row">Recovery</th><td><span className={s.enabled && !s.paused ? 'badge' : 'badge badge--warn'}>{!s.enabled ? 'Off' : s.paused ? 'Paused' : 'On'}</span></td></tr>
                <tr><th scope="row">Email provider</th><td>{data.readiness.emailProvider ? 'Configured' : 'Not configured (nothing is sent)'}</td></tr>
                <tr><th scope="row">Email links</th><td>{data.readiness.links ? 'Configured' : 'Needs SUBSCRIBE_TOKEN_SECRET and a real https SITE_URL (nothing is sent)'}</td></tr>
              </tbody>
            </table>
          </div>
          {!ready && s.enabled && <p className="form-status form-status--info" role="status">Recovery is on but cannot send until the items above are configured. Nothing is lost: reminders wait.</p>}
          {canManage && (
            <div className="admin-actions" role="group" aria-label="Recovery controls">
              <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void save({ enabled: !s.enabled }, s.enabled ? 'Recovery is off.' : 'Recovery is on.')}>{s.enabled ? 'Turn recovery off' : 'Turn recovery on'}</button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy || !s.enabled} onClick={() => void save({ paused: !s.paused }, s.paused ? 'Recovery resumed.' : 'Recovery paused. Waiting reminders are kept, none are sent.')}>{s.paused ? 'Resume' : 'Pause'}</button>
            </div>
          )}

          <h2>Numbers</h2>
          <div className="aprod-chips" role="group" aria-label="Period">
            {PERIODS.map(([id, label]) => (
              <button key={id} type="button" className="aprod-chip" aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>
            ))}
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Cart recovery numbers</caption>
              <thead><tr><th scope="col">Measure</th><th scope="col">Value</th><th scope="col">What it means</th></tr></thead>
              <tbody>
                {rows.map(([label, value, def]) => (
                  <tr key={label}><th scope="row">{label}</th><td>{value}</td><td className="muted">{data.definitions[def] ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field-hint">Revenue here is attributed to a reminder because the customer clicked it and then paid. It is not proof that the reminder caused the sale.</p>
          {st && st.top_products.length > 0 && (
            <>
              <h3>Most often in abandoned bags</h3>
              <ul>{st.top_products.map((t) => <li key={`${t.product}-${t.pack_size}`}>{t.product}, {t.pack_size}: {t.carts}</li>)}</ul>
            </>
          )}

          {canManage && (
            <>
              <h2>Timing and limits</h2>
              <p className="field-hint">Reminder delays are minutes after a bag counts as abandoned, which is the inactivity time after its last change. They are suggestions you can change, not promises: with a once-a-day scheduler the real send time is the next run.</p>
              <div>
                {([['inactivity', 'Inactivity before a bag counts as abandoned (minutes)'], ['d1', 'Reminder 1 delay (minutes)'], ['d2', 'Reminder 2 delay (minutes)'], ['d3', 'Reminder 3 delay (minutes)'], ['perCycle', 'Reminders per bag (1 to 3)'], ['perMember', 'Most reminders per customer in 7 days'], ['batch', 'Reminders per run (batch size)']] as const).map(([k, label]) => (
                  <div className="field" key={k}>
                    <label htmlFor={`rec-${k}`}>{label}</label>
                    <input id={`rec-${k}`} inputMode="numeric" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn--sm" disabled={busy} onClick={saveTiming}>Save timing and limits</button>
            </>
          )}

          <h2>Bags being recovered</h2>
          {data.cycles.length === 0 ? (
            <p className="muted">None right now.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Open recovery cycles</caption>
                <thead><tr><th scope="col">Customer</th><th scope="col">Abandoned</th><th scope="col">Items</th><th scope="col">Reminders</th></tr></thead>
                <tbody>
                  {data.cycles.map((c) => (
                    <tr key={c.id}>
                      <td>{c.customer}</td>
                      <td>{when(c.abandonedAt)}</td>
                      <td>{c.items}</td>
                      <td>{[...c.messages].sort((a, b) => a.step - b.step).map((m) => `${m.step}: ${m.status}${m.clicked_at ? ' (opened)' : ''}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>Recent failures and skips</h2>
          {data.failures.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Recent failed or skipped reminders</caption>
                <thead><tr><th scope="col">When</th><th scope="col">Reminder</th><th scope="col">Result</th><th scope="col">Reason</th></tr></thead>
                <tbody>
                  {data.failures.map((f) => (
                    <tr key={f.id}><td>{when(f.updated_at)}</td><td>{f.step}</td><td>{f.status}</td><td>{f.reason ?? ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
