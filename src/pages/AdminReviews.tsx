import { useEffect, useState } from 'react';
import { REPORT_REASON_LABELS, SAFETY_FLAG_LABELS, type ReportReason } from '../../shared/reviews';
import { ConfirmDialog, Pager, api, errorText, useMe, usePaged, when } from '../lib/adminKit';

interface Row {
  id: string;
  rating: number;
  title: string;
  body: string;
  status: string;
  status_reason: string | null;
  safety_flags: string[];
  customer: string;
  created_at: string;
  products: { slug: string; public_name: string | null; internal_name: string } | null;
  review_replies: { body: string; author: string; updated_at: string } | null;
  review_images: { id: string; file: string; status: string }[];
  review_reports: { id: string; status: string }[];
}
interface ReportRow { id: string; review_id: string; reason: ReportReason; note: string | null; status: string; created_at: string; product_reviews: { rating: number; title: string; body: string; status: string } | null }
interface EventRow { id: number; actor: string; action: string; from_status: string | null; to_status: string | null; reason: string | null; created_at: string }
interface Analytics {
  byProduct: { productId: string; name: string; count: number; average: number; distribution: Record<string, number> }[];
  byStatus: Record<string, number>;
  trend: { day: string; count: number }[];
  openReports: number;
  moderation: Record<string, number>;
}
type View = 'reviews' | 'reports' | 'analytics';
const STATUSES = ['', 'PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED', 'WITHDRAWN'];

export default function AdminReviews({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [view, setView] = useState<View>('reviews');
  return (
    <div>
      <div className="admin-toolbar" role="tablist" aria-label="Review sections">
        {(['reviews', 'reports', 'analytics'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={`btn btn--sm ${view === v ? '' : 'btn--ghost'}`} onClick={() => setView(v)}>{v === 'reviews' ? 'Reviews' : v === 'reports' ? 'Reports' : 'Analytics'}</button>
        ))}
      </div>
      <p className="muted">Reviews come only from customers with a delivered, paid order. You can hide or restore a review and reply to it, but never change a customer's stars or words. Every action is recorded.</p>
      {view === 'reviews' && <ReviewList onExpired={onExpired} canModerate={me.can('reviews.moderate')} canReply={me.can('reviews.reply')} />}
      {view === 'reports' && <Reports onExpired={onExpired} canModerate={me.can('reviews.moderate')} />}
      {view === 'analytics' && <AnalyticsView onExpired={onExpired} />}
    </div>
  );
}

function ReviewList({ onExpired, canModerate, canReply }: { onExpired: () => void; canModerate: boolean; canReply: boolean }) {
  const [status, setStatus] = useState('PENDING');
  const [rating, setRating] = useState('');
  const [flagged, setFlagged] = useState(false);
  const params = [status && `status=${status}`, rating && `rating=${rating}`, flagged && 'flagged=1'].filter(Boolean).join('&');
  const { page, setPage, data, error, loading, reload } = usePaged<Row>(`reviews${params ? `?${params}` : ''}`, onExpired);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ row: Row; action: 'hide' | 'reject' | 'restore' | 'approve' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const [history, setHistory] = useState<{ id: string; items: EventRow[] } | null>(null);

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    const r = await api(path, { method: 'POST', body });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (!r.ok) { setNotice(errorText(r, 'That did not work.')); return false; }
    setNotice(done);
    reload();
    return true;
  }

  return (
    <div>
      <div className="admin-toolbar">
        <label>Status <select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}</select></label>
        <label>Stars <select value={rating} onChange={(e) => setRating(e.target.value)}><option value="">All</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} /> Health-claim or contact flag only</label>
      </div>
      {notice && <p role="status" className="admin-notice">{notice}</p>}
      {error && <p role="alert" className="admin-error">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && data.items.length === 0 && <p className="muted">No reviews match.</p>}
      {data?.items.map((r) => (
        <article key={r.id} className="admin-card" style={{ marginBottom: '1rem' }}>
          <p><strong>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} {r.title}</strong> <span className="badge">{r.status}</span></p>
          <p className="muted">{r.products?.public_name ?? r.products?.internal_name} · {r.customer} · {when(r.created_at)}{r.review_reports.filter((x) => x.status === 'OPEN').length > 0 ? ` · ${r.review_reports.filter((x) => x.status === 'OPEN').length} open report(s)` : ''}</p>
          <p style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{r.body}</p>
          {r.safety_flags.length > 0 && <p className="admin-error">Held for a check: {r.safety_flags.map((f) => SAFETY_FLAG_LABELS[f] ?? f).join(', ')}. Ordinary criticism is not a reason to hide a review.</p>}
          {r.status_reason && <p className="muted">Reason recorded: {r.status_reason}</p>}
          {r.review_images.map((i) => (
            <span key={i.id} style={{ display: 'inline-block', marginRight: '0.5rem' }}>
              <img src={`/api/admin/review-image?file=${i.file}`} alt="Customer photo awaiting a decision" width="96" height="96" style={{ objectFit: 'cover' }} /><br />
              <small>{i.status}</small>
              {canModerate && i.status === 'PENDING' && <><br /><button className="btn btn--sm" disabled={busy} onClick={() => void act('review-image-decide', { image: i.id, approve: true }, 'Photo approved.')}>Approve</button> <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act('review-image-decide', { image: i.id, approve: false }, 'Photo rejected.')}>Reject</button></>}
            </span>
          ))}
          {r.review_replies && <p className="muted"><strong>Brand reply</strong> ({r.review_replies.author}, {when(r.review_replies.updated_at)}): {r.review_replies.body}</p>}
          <div className="admin-actions">
            {canModerate && r.status === 'PENDING' && <button className="btn btn--sm" onClick={() => { setReason(''); setPending({ row: r, action: 'approve' }); }}>Publish</button>}
            {canModerate && r.status === 'PENDING' && <button className="btn btn--ghost btn--sm" onClick={() => { setReason(''); setPending({ row: r, action: 'reject' }); }}>Reject</button>}
            {canModerate && (r.status === 'PUBLISHED' || r.status === 'PENDING') && <button className="btn btn--ghost btn--sm" onClick={() => { setReason(''); setPending({ row: r, action: 'hide' }); }}>Hide</button>}
            {canModerate && (r.status === 'HIDDEN' || r.status === 'REJECTED') && <button className="btn btn--sm" onClick={() => { setReason(''); setPending({ row: r, action: 'restore' }); }}>Restore</button>}
            {canReply && r.status !== 'WITHDRAWN' && <button className="btn btn--ghost btn--sm" onClick={() => setReply({ id: r.id, text: r.review_replies?.body ?? '' })}>{r.review_replies ? 'Edit reply' : 'Reply'}</button>}
            <button className="btn btn--ghost btn--sm" onClick={() => void api<{ items: EventRow[] }>(`review-events?review=${r.id}`).then((x) => x.ok && x.data && setHistory({ id: r.id, items: x.data.items }))}>History</button>
          </div>
          {reply?.id === r.id && (
            <div>
              <label>Reply (shown publicly, labelled as from Kaayra Herbals)<textarea rows={3} maxLength={1000} value={reply.text} onChange={(e) => setReply({ id: r.id, text: e.target.value })} /></label>
              <div className="admin-actions"><button className="btn btn--sm" disabled={busy} onClick={() => void act('review-reply', { review: r.id, body: reply.text }, 'Reply saved.').then((ok) => ok && setReply(null))}>Save reply</button><button className="btn btn--ghost btn--sm" onClick={() => setReply(null)}>Cancel</button></div>
            </div>
          )}
          {history?.id === r.id && (
            <ul className="muted">{history.items.length === 0 ? <li>No moderation actions yet.</li> : history.items.map((e) => <li key={e.id}>{when(e.created_at)} · {e.actor} · {e.action}{e.to_status ? ` (${e.from_status} → ${e.to_status})` : ''}{e.reason ? ` · ${e.reason}` : ''}</li>)}</ul>
          )}
        </article>
      ))}
      {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending ? `${{ hide: 'Hide', reject: 'Reject', restore: 'Restore', approve: 'Publish' }[pending.action]} this review?` : ''}
        confirmLabel={pending ? { hide: 'Hide review', reject: 'Reject review', restore: 'Restore review', approve: 'Publish review' }[pending.action] : ''}
        danger={pending?.action === 'hide' || pending?.action === 'reject'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => { if (pending) void act('review-moderate', { review: pending.row.id, action: pending.action, reason }, 'Done.').then((ok) => ok && setPending(null)); }}
      >
        <p>The customer's stars and words are never changed. {pending && (pending.action === 'hide' || pending.action === 'reject') ? 'Give a reason under the review policy (spam, harassment, personal information, unsafe health claim, other). A review is not removed for being critical.' : ''}</p>
        {pending && (pending.action === 'hide' || pending.action === 'reject') && <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>}
      </ConfirmDialog>
    </div>
  );
}

function Reports({ onExpired, canModerate }: { onExpired: () => void; canModerate: boolean }) {
  const [status, setStatus] = useState('OPEN');
  const { page, setPage, data, error, reload } = usePaged<ReportRow>(`review-reports?status=${status}`, onExpired);
  const [notice, setNotice] = useState('');
  async function handle(id: string, outcome: 'DISMISSED' | 'ACTIONED') {
    const r = await api('review-report-handle', { method: 'POST', body: { report: id, outcome } });
    if (r.status === 401) return onExpired();
    setNotice(r.ok ? 'Report updated.' : errorText(r, 'That did not work.'));
    if (r.ok) reload();
  }
  return (
    <div>
      <div className="admin-toolbar"><label>Status <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="OPEN">Open</option><option value="DISMISSED">Dismissed</option><option value="ACTIONED">Actioned</option><option value="">All</option></select></label></div>
      <p className="muted">A report never removes a review by itself. Look at the review, then hide it under the policy or dismiss the report.</p>
      {notice && <p role="status" className="admin-notice">{notice}</p>}
      {error && <p role="alert" className="admin-error">{error}</p>}
      {data?.items.length === 0 && <p className="muted">No reports.</p>}
      {data?.items.map((r) => (
        <article key={r.id} className="admin-card" style={{ marginBottom: '1rem' }}>
          <p><strong>{REPORT_REASON_LABELS[r.reason] ?? r.reason}</strong> <span className="badge">{r.status}</span> · {when(r.created_at)}</p>
          {r.note && <p>Reporter's note: {r.note}</p>}
          {r.product_reviews && <p className="muted">Review ({r.product_reviews.status}): {'★'.repeat(r.product_reviews.rating)} {r.product_reviews.title} — {r.product_reviews.body.slice(0, 200)}</p>}
          {canModerate && r.status === 'OPEN' && <div className="admin-actions"><button className="btn btn--ghost btn--sm" onClick={() => void handle(r.id, 'DISMISSED')}>Dismiss</button><button className="btn btn--sm" onClick={() => void handle(r.id, 'ACTIONED')}>Mark actioned</button></div>}
        </article>
      ))}
      {data && <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
    </div>
  );
}

function AnalyticsView({ onExpired }: { onExpired: () => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void api<Analytics>(`review-analytics?days=${days}`).then((r) => {
      if (!live) return;
      if (r.status === 401) return onExpired();
      if (!r.ok || !r.data) return setError(errorText(r, 'Could not load analytics.'));
      setError('');
      setData(r.data);
    });
    return () => { live = false; };
  }, [days, onExpired]);
  return (
    <div>
      <div className="admin-toolbar"><label>Window <select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></select></label></div>
      <p className="muted">All figures are counted in the database from published reviews. Nothing here is estimated or generated.</p>
      {error && <p role="alert" className="admin-error">{error}</p>}
      {data && (
        <>
          <p>Open reports: <strong>{data.openReports}</strong> · By status: {Object.entries(data.byStatus).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'}</p>
          <h3 className="admin-subhead">Rating by product</h3>
          {data.byProduct.length === 0 ? <p className="muted">No published reviews yet.</p> : (
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Reviews</th><th>Average</th><th>5★</th><th>4★</th><th>3★</th><th>2★</th><th>1★</th></tr></thead>
              <tbody>{data.byProduct.map((p) => <tr key={p.productId}><td>{p.name}</td><td>{p.count}</td><td>{p.average.toFixed(2)}</td>{['5', '4', '3', '2', '1'].map((k) => <td key={k}>{p.distribution[k] ?? 0}</td>)}</tr>)}</tbody></table></div>
          )}
          <h3 className="admin-subhead">Reviews submitted per day</h3>
          {data.trend.length === 0 ? <p className="muted">None in this window.</p> : <ul>{data.trend.map((t) => <li key={t.day}>{t.day}: {t.count}</li>)}</ul>}
          <h3 className="admin-subhead">Moderation activity</h3>
          <p>{Object.entries(data.moderation).map(([k, v]) => `${k} ${v}`).join(', ') || 'No moderation actions in this window.'}</p>
        </>
      )}
    </div>
  );
}
