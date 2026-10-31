import { useCallback, useEffect, useState } from 'react';
import { CONTENT_KINDS, CONTENT_LABELS, type ContentKind } from '../../shared/ai';
import type { Snapshot } from '../../server/ai/data';
import type { Panel } from '../../server/ai/panels';
import { ConfirmDialog, api, errorText, useMe, when } from '../lib/adminKit';

interface Status { enabled: boolean; ready: boolean; model: string; providers: { id: string; label: string; model: string; configured: boolean }[]; problems: string[]; canIntelligence: boolean; canContent: boolean; privacy: string; usage: { today: { customer: { requests: number; limit: number }; admin: { requests: number; limit: number } }; last7Days: { requests: number; inputTokens: number; outputTokens: number; estimatedUsd: number } } | null }
interface Briefing { narrative: string; model: string; generated_by: string; generated_at: string }
interface Draft { id: string; kind: ContentKind; product_id: string | null; topic: string | null; body: string; status: 'draft' | 'approved' | 'rejected'; flags: string[]; model: string; created_by: string; created_at: string }
interface ProductOpt { id: string; internal_name: string; public_name: string | null }
type View = 'briefing' | 'ask' | 'content';
const EXAMPLES = ['What needs my attention today?', 'Which products are selling fastest?', 'Which products need restocking?', 'Summarise my business performance.'];

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="ai-meter">
      <div className="ai-meter-top"><span>{label}</span><strong>{used} / {limit}</strong></div>
      <div className="ai-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}><i style={{ width: `${pct}%` }} data-high={pct >= 80 ? 'yes' : 'no'} /></div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string | number | null }) => <li><span className="muted">{k}:</span> <strong>{v ?? 'Not enough data'}</strong></li>;

const list = (xs: string[]): string => (xs.length === 0 ? 'none' : xs.join('; '));

function Figures({ s }: { s: Snapshot }) {
  const f = s.finance;
  const sales = s.sales;
  const inv = s.inventory;
  const ops = s.operations;
  return (
    <div>
      {f && (
        <article className="admin-card" style={{ marginBottom: '1rem' }}>
          <h3>Revenue and profit</h3>
          <ul className="admin-plain">
            <Row k="Net collected today" v={`${f.today.netCollected} from ${f.today.orders} orders`} />
            <Row k="Net collected, last 7 days" v={`${f.last7Days.netCollected} from ${f.last7Days.orders} orders`} />
            <Row k="Average order, last 7 days" v={f.last7Days.averageOrder} />
            <Row k="Change vs the 7 days before" v={f.last7Days.growthVsPrevious7Days} />
            <Row k="Net collected, last 30 days" v={`${f.last30Days.netCollected} from ${f.last30Days.orders} orders`} />
            <Row k="Refunds paid, last 30 days" v={f.last30Days.refundsPaid} />
            <Row k="Profit" v={f.last30Days.profitStatus === 'complete' ? `gross ${f.last30Days.grossProfit}, net ${f.last30Days.netProfit} (before income tax)` : f.last30Days.profitMessage} />
          </ul>
          {f.last30Days.gaps.length > 0 && <p className="muted">To complete profit: {f.last30Days.gaps.join(' ')}</p>}
          {f.refundsLast30Days && <p className="muted">Refund rate {f.refundsLast30Days.ratePercent ?? 'n/a'}; {f.refundsLast30Days.pending} requested or approved but not yet paid.</p>}
          {f.salesForecast && <p className="muted">Forecast (estimate): {f.salesForecast.expected ? `${f.salesForecast.expected} over 30 days (range ${f.salesForecast.low} to ${f.salesForecast.high}). ` : ''}{f.salesForecast.label}</p>}
          <p className="muted">{f.notes.join(' ')}</p>
        </article>
      )}
      {sales && (
        <article className="admin-card" style={{ marginBottom: '1rem' }}>
          <h3>Orders, last {sales.windowDays} days</h3>
          <ul className="admin-plain">
            <Row k="Orders (not cancelled)" v={sales.orders} />
            <Row k="Order value" v={sales.revenue} />
            <Row k="Average order" v={sales.averageOrder} />
            <Row k="Change vs the period before" v={sales.revenueChangeVsPreviousPeriod} />
            <Row k="Cancelled" v={sales.cancelled} />
            <Row k="Awaiting payment" v={sales.awaitingPayment} />
            <Row k="Paid, to pack and ship" v={sales.paidToFulfil} />
          </ul>
          {sales.topProducts.length > 0 && <p className="muted">Best sellers: {sales.topProducts.map((t) => `${t.name} (${t.units} sold)`).join(', ')}</p>}
          <p className="muted">{sales.note}</p>
        </article>
      )}
      {inv && (
        <article className="admin-card" style={{ marginBottom: '1rem' }}>
          <h3>Inventory alerts</h3>
          <ul className="admin-plain">
            <Row k="Out of stock" v={list(inv.outOfStock.map((x) => `${x.product} ${x.pack}`))} />
            <Row k="Low stock" v={list(inv.lowStock.map((x) => `${x.product} ${x.pack} (${x.units} left)`))} />
            <Row k="Expired units" v={inv.expiredUnits} />
            <Row k="Expiring soon (units)" v={inv.expiringUnits} />
          </ul>
          {inv.roughDaysOfCover.length > 0 && <p className="muted">Rough days of cover at recent sales: {inv.roughDaysOfCover.map((x) => `${x.product} ${x.pack} about ${x.days}`).join('; ')}</p>}
          {f?.inventoryValue && <p className="muted">Stock cost value {f.inventoryValue.costValue}; {f.inventoryValue.slowMovingUnits} units have not sold in {f.inventoryValue.slowWindowDays} days.</p>}
          <p className="muted">{inv.note}</p>
        </article>
      )}
      {ops && (
        <article className="admin-card" style={{ marginBottom: '1rem' }}>
          <h3>Operations</h3>
          <ul className="admin-plain">
            {ops.shipments && <Row k="Delayed shipments" v={list(ops.shipments.delayed.map((d) => `${d.shipment_no} (${d.daysLate} days late)`))} />}
            {ops.shipments && <Row k="Shipments in motion" v={ops.shipments.inMotion} />}
            {ops.refundQueue && <Row k="Refund requests awaiting a decision" v={ops.refundQueue.awaitingDecision} />}
            {ops.refundQueue && <Row k="Approved refunds not yet paid" v={ops.refundQueue.approvedNotYetPaid} />}
            {ops.paymentsNeedingReview !== undefined && <Row k="Payments needing review" v={ops.paymentsNeedingReview} />}
          </ul>
        </article>
      )}
      {s.incompleteSections.length > 0 && <p className="admin-error">These figures may be understated because there was too much data to read: {s.incompleteSections.join(', ')}.</p>}
      {s.unavailableSections.length > 0 && <p className="muted">Not shown: {s.unavailableSections.join('; ')}.</p>}
    </div>
  );
}

export default function AdminIntelligence({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [status, setStatus] = useState<Status | null>(null);
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState<View>('briefing');
  const [error, setError] = useState('');

  useEffect(() => {
    void api<Status>('ai-status').then((r) => {
      if (r.status === 401) return onExpired();
      if (r.status === 403) return setDenied(true);
      if (r.ok && r.data) setStatus(r.data);
      else setError(errorText(r, 'Could not load AI status.'));
    });
  }, [onExpired]);

  if (denied) return <p className="muted">Kaayra Intelligence is available to the owner and to admins the owner has authorised.</p>;
  if (!status) return error ? <p role="alert" className="admin-error">{error}</p> : <p className="muted">Loading…</p>;
  const views: { id: View; label: string; show: boolean }[] = [
    { id: 'briefing', label: 'Daily briefing', show: status.canIntelligence },
    { id: 'ask', label: 'Ask a question', show: status.canIntelligence },
    { id: 'content', label: 'Content studio', show: status.canContent },
  ];
  const shown = views.filter((v) => v.show);
  const current = shown.some((v) => v.id === view) ? view : shown[0]?.id;

  return (
    <div>
      <article className="admin-card ai-status">
        <div className="ai-status-head">
          <div>
            <h2 className="ai-title">Kaayra Intelligence</h2>
            <p className="muted">Your private business assistant</p>
          </div>
          <span className={`badge${status.ready ? '' : ' badge--warn'}`}>{status.ready ? 'On' : status.enabled ? 'Needs setup' : 'Off'}</span>
        </div>
        <ol className="ai-providers" aria-label="AI providers, in the order they are tried">
          {status.providers.map((p) => <li key={p.id} data-on={p.configured ? 'yes' : 'no'}><strong>{p.label}</strong><span>{p.configured ? p.model : 'not set up'}</span></li>)}
        </ol>
        <p className="muted ai-note">If the first provider runs out of its free allowance or is down, the next one answers automatically.</p>
        {!status.ready && <p className="muted">{status.problems.length > 0 ? status.problems.join('. ') : 'Set AI_ENABLED=on and GEMINI_API_KEY in Vercel to switch AI on.'} The figures below still work without AI.</p>}
        {status.usage && (
          <div className="ai-meters">
            <Meter label="Visitor chat today" used={status.usage.today.customer.requests} limit={status.usage.today.customer.limit} />
            <Meter label="Owner tools today" used={status.usage.today.admin.requests} limit={status.usage.today.admin.limit} />
            <p className="muted ai-week">Last 7 days: {status.usage.last7Days.requests} requests · {status.usage.last7Days.inputTokens + status.usage.last7Days.outputTokens} tokens · about ${status.usage.last7Days.estimatedUsd} (an estimate, not a bill)</p>
          </div>
        )}
        {status.usage === null && <p className="muted">Usage counters are unavailable. Run supabase/ai.sql; until then AI stays paused to protect your budget.</p>}
        <details className="ai-privacy"><summary>Privacy</summary><p className="muted">{status.privacy}</p></details>
      </article>
      <div className="admin-toolbar" role="tablist" aria-label="Intelligence sections">
        {shown.map((v) => <button key={v.id} role="tab" aria-selected={current === v.id} className={`btn btn--sm ${current === v.id ? '' : 'btn--ghost'}`} onClick={() => setView(v.id)}>{v.label}</button>)}
      </div>
      {current === 'briefing' && <BriefingView ready={status.ready} onExpired={onExpired} />}
      {current === 'ask' && <AskView ready={status.ready} onExpired={onExpired} />}
      {current === 'content' && <ContentView ready={status.ready} canApprove={me.can('products.status')} onExpired={onExpired} />}
    </div>
  );
}

function BriefingView({ ready, onExpired }: { ready: boolean; onExpired: () => void }) {
  const [snap, setSnap] = useState<{ snapshot: Snapshot; empty: boolean } | null>(null);
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api<{ snapshot: Snapshot; empty: boolean }>('ai-snapshot'), api<{ briefing: Briefing | null }>('ai-briefing')]);
    if (a.status === 401) return onExpired();
    if (a.ok && a.data) setSnap(a.data); else setMsg(errorText(a, 'Could not load the figures.'));
    if (b.ok && b.data) setBrief(b.data.briefing);
  }, [onExpired]);
  useEffect(() => { void load(); }, [load]);
  const generate = async () => {
    setBusy(true); setMsg('');
    const r = await api<{ briefing?: Briefing; message?: string }>('ai-briefing', { method: 'POST', body: { regenerate: brief !== null } });
    setBusy(false);
    if (r.ok && r.data?.briefing) setBrief(r.data.briefing); else setMsg(r.data?.message ?? errorText(r, 'Could not write the briefing.'));
  };
  return (
    <div>
      <h3>Today&apos;s business briefing</h3>
      {msg && <p role="alert" className="admin-error">{msg}</p>}
      {!snap ? <p className="muted">Loading figures…</p> : snap.empty ? <p className="muted">Not enough data available yet.</p> : <Figures s={snap.snapshot} />}
      <article className="admin-card">
        <h4>Written summary</h4>
        {brief ? <><p style={{ whiteSpace: 'pre-wrap' }}>{brief.narrative}</p><p className="muted">Written by {brief.model} for {brief.generated_by} on {when(brief.generated_at)} from the figures above. AI can misread; the figures are the record.</p></> : <p className="muted">No written summary yet today. It is made on request, not on a schedule, so it only uses your allowance when you ask.</p>}
        <div className="admin-actions"><button className="btn btn--sm" disabled={busy || !ready || !snap || snap.empty} onClick={() => void generate()}>{busy ? 'Writing…' : brief ? 'Regenerate summary' : 'Write summary'}</button></div>
      </article>
    </div>
  );
}

interface QA { q: string; a?: string; err?: string; by?: string; panels?: Panel[] }

/** Real figures from your own data, shown under every answer (and on their own when the AI could not answer). Copied from the verified numbers, never written by the model. */
function Panels({ panels }: { panels: Panel[] }) {
  if (panels.length === 0) return null;
  return (
    <div className="ai-panels">
      {panels.map((p) => (
        <section key={p.id} className="ai-panel" aria-label={p.title}>
          <h4>{p.title}</h4>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr>{p.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
              <tbody>{p.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
            </table>
          </div>
          {p.note && <p className="muted">{p.note}</p>}
        </section>
      ))}
    </div>
  );
}

function AskView({ ready, onExpired }: { ready: boolean; onExpired: () => void }) {
  const [q, setQ] = useState('');
  const [thread, setThread] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  useEffect(() => {
    if (!busy) { setSecs(0); return; }
    const t = window.setInterval(() => setSecs((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [busy]);
  const ask = async (text: string) => {
    const question = text.trim();
    if (question.length < 3 || busy) return;
    setBusy(true); setQ('');
    setThread((t) => [{ q: question }, ...t].slice(0, 12));
    const r = await api<{ answer?: string; message?: string; provider?: string; panels?: Panel[] }>('ai-ask', { method: 'POST', body: { question } });
    setBusy(false);
    if (r.status === 401) return onExpired();
    const panels = Array.isArray(r.data?.panels) ? r.data.panels : [];
    const next: Partial<QA> = r.ok && r.data?.answer ? { a: r.data.answer, by: r.data.provider, panels } : { err: r.data?.message ?? errorText(r, 'No answer.'), panels };
    setThread((t) => t.map((x, i) => (i === 0 ? { ...x, ...next } : x)));
  };
  const copy = (i: number, text: string) => { void navigator.clipboard?.writeText(text); setCopied(i); window.setTimeout(() => setCopied(null), 1500); };
  return (
    <div>
      <h3>Ask about your business</h3>
      <p className="muted">Answers are written from your real, calculated figures. The assistant cannot change stock, prices, orders or refunds.</p>
      <div className="admin-actions">{EXAMPLES.map((e) => <button key={e} className="btn btn--ghost btn--sm" disabled={busy || !ready} onClick={() => void ask(e)}>{e}</button>)}</div>
      <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} style={{ marginTop: '1rem' }}>
        <label>Your question<textarea value={q} maxLength={300} rows={2} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(q); } }} style={{ width: '100%' }} /></label>
        <div className="admin-actions"><button className="btn btn--sm" disabled={busy || !ready || q.trim().length < 3}>{busy ? `Working… ${secs}s` : 'Ask'}</button><span className="muted">Enter to send, Shift+Enter for a new line.</span></div>
      </form>
      {thread.map((t, i) => (
        <article key={`${thread.length - i}-${t.q}`} className="admin-card" style={{ marginTop: '1rem' }} aria-live={i === 0 ? 'polite' : undefined}>
          <p><strong>{t.q}</strong></p>
          {t.a !== undefined && <p style={{ whiteSpace: 'pre-wrap' }}>{t.a}</p>}
          {t.err !== undefined && <p role="alert" className="admin-error">{t.err}</p>}
          {t.panels && t.panels.length > 0 && <Panels panels={t.panels} />}
          {t.a === undefined && t.err === undefined && <p className="muted">Reading your figures and writing the answer{i === 0 && secs > 0 ? ` (${secs}s)` : ''}…</p>}
          {t.a !== undefined && <div className="admin-actions"><button className="btn btn--ghost btn--sm" onClick={() => copy(i, t.a ?? '')}>{copied === i ? 'Copied' : 'Copy answer'}</button><span className="muted">Every figure in this answer was checked against your calculated data before it was shown.{t.by ? ` Answered by ${t.by}.` : ''}</span></div>}
        </article>
      ))}
    </div>
  );
}

function ContentView({ ready, canApprove, onExpired }: { ready: boolean; canApprove: boolean; onExpired: () => void }) {
  const [kind, setKind] = useState<ContentKind>('product_description');
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [productId, setProductId] = useState('');
  const [topic, setTopic] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [del, setDel] = useState<Draft | null>(null);
  const load = useCallback(async () => {
    const [d, p] = await Promise.all([api<{ items: Draft[] }>('ai-drafts'), api<{ items: ProductOpt[] }>('products')]);
    if (d.status === 401) return onExpired();
    if (d.ok && d.data) setDrafts(d.data.items); else setMsg(errorText(d, 'Could not load drafts.'));
    if (p.ok && p.data) setProducts(p.data.items);
  }, [onExpired]);
  useEffect(() => { void load(); }, [load]);
  const act = async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setMsg('');
    const r = await api<{ message?: string }>(path, { method: 'POST', body });
    setBusy(false);
    if (!r.ok) setMsg(r.data?.message ?? errorText(r, 'That did not work.'));
    await load();
    return r.ok;
  };
  return (
    <div>
      <h3>Content studio</h3>
      <p className="muted">Everything written here is a draft. Nothing is published or copied into a product automatically: review it, copy it into the product or journal editor yourself, and only the owner can mark a draft approved. Drafts use only verified product facts.</p>
      <form className="admin-toolbar" onSubmit={(e) => { e.preventDefault(); setBusy(true); setMsg(''); void api<{ message?: string }>('ai-content', { method: 'POST', body: { kind, product_id: productId || undefined, topic: topic || undefined } }).then(async (r) => { setBusy(false); if (!r.ok) setMsg(r.data?.message ?? errorText(r, 'Could not write the draft.')); await load(); }); }}>
        <label>Write <select value={kind} onChange={(e) => setKind(e.target.value as ContentKind)}>{CONTENT_KINDS.map((k) => <option key={k} value={k}>{CONTENT_LABELS[k]}</option>)}</select></label>
        <label>Product <select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">None</option>{products.map((p) => <option key={p.id} value={p.id}>{p.public_name ?? p.internal_name}</option>)}</select></label>
        <label>Topic or notes <input value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} /></label>
        <button className="btn btn--sm" disabled={busy || !ready}>{busy ? 'Writing…' : 'Write draft'}</button>
      </form>
      {msg && <p role="alert" className="admin-error">{msg}</p>}
      {drafts.length === 0 && <p className="muted">No drafts yet.</p>}
      {drafts.map((d) => (
        <article key={d.id} className="admin-card" style={{ marginBottom: '1rem' }}>
          <p><strong>{CONTENT_LABELS[d.kind]}</strong> <span className="badge">{d.status}</span> <span className="muted">{products.find((p) => p.id === d.product_id)?.internal_name ?? ''} · {d.created_by} · {when(d.created_at)} · {d.model}</span></p>
          {d.flags.length > 0 && <p className="admin-error">Held for a check (it cannot be approved until edited): {d.flags.join('; ')}.</p>}
          {editing?.id === d.id ? <textarea value={editing.text} rows={8} style={{ width: '100%' }} onChange={(e) => setEditing({ id: d.id, text: e.target.value })} /> : <p style={{ whiteSpace: 'pre-wrap' }}>{d.body}</p>}
          <div className="admin-actions">
            {editing?.id === d.id ? <><button className="btn btn--sm" disabled={busy} onClick={() => void act('ai-draft-edit', { id: d.id, body: editing.text }).then((ok) => ok && setEditing(null))}>Save and re-check</button><button className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancel</button></> : <button className="btn btn--ghost btn--sm" onClick={() => setEditing({ id: d.id, text: d.body })}>Edit</button>}
            <button className="btn btn--ghost btn--sm" onClick={() => void navigator.clipboard?.writeText(d.body)}>Copy</button>
            {canApprove && d.status !== 'approved' && <button className="btn btn--sm" disabled={busy || d.flags.length > 0} onClick={() => void act('ai-draft-decide', { id: d.id, decision: 'approved' })}>Approve</button>}
            {d.status !== 'rejected' && <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act('ai-draft-decide', { id: d.id, decision: 'rejected' })}>Reject</button>}
            <button className="btn btn--ghost btn--sm btn--danger" onClick={() => setDel(d)}>Delete</button>
          </div>
        </article>
      ))}
      <ConfirmDialog open={del !== null} title="Delete this draft?" confirmLabel="Delete" danger busy={busy} onCancel={() => setDel(null)} onConfirm={() => { if (del) void act('ai-draft-delete', { id: del.id }).then(() => setDel(null)); }}>This removes the draft for good.</ConfirmDialog>
    </div>
  );
}
