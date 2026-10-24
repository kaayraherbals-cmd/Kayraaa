import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BODY_MAX, BODY_MIN, MAX_REVIEW_IMAGES, REPORT_REASONS, REPORT_REASON_LABELS, TITLE_MAX, TITLE_MIN, type ReportReason } from '../../../shared/reviews';
import { reviewsApi, type OwnReview, type PublicReview, type ReviewStats } from '../../lib/reviewsApi';
import { useSession } from '../../lib/session';

const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

function Stars({ value, label }: { value: number; label: string }) {
  return (
    <span className="rv-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} aria-hidden="true" className={n <= Math.round(value) ? 'on' : ''}>★</span>)}
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <fieldset className="rv-picker">
      <legend>Your rating</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={n <= value ? 'on' : ''}>
          <input type="radio" name="rv-rating" value={n} checked={value === n} onChange={() => onChange(n)} />
          <span aria-hidden="true">★</span>
          <span className="rv-sr">{n} {n === 1 ? 'star' : 'stars'}</span>
        </label>
      ))}
    </fieldset>
  );
}

const readFile = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error('read')); r.readAsDataURL(f); });

function ReviewForm({ slug, existing, onDone, onCancel }: { slug: string; existing: OwnReview | null; onDone: (message: string) => void; onCancel: () => void }) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const room = MAX_REVIEW_IMAGES - (existing?.review_images.length ?? 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (rating < 1) return setError('Choose a rating from 1 to 5 stars.');
    setBusy(true);
    const r = existing ? await reviewsApi.update(existing.id, rating, title, body) : await reviewsApi.submit(slug, rating, title, body);
    if (!r.ok) { setBusy(false); return setError(r.message); }
    let note = r.data.held ? 'Thank you. Your review is with our team and will appear once it has been checked.' : 'Thank you. Your review is now live.';
    for (const f of files.slice(0, room)) {
      try {
        const u = await reviewsApi.uploadImage(r.data.id, await readFile(f));
        if (!u.ok) note += ` A photo was not added: ${u.message}`;
        else note += ' Photos appear after approval.';
      } catch { note += ' A photo could not be read.'; }
    }
    setBusy(false);
    onDone(note);
  }

  return (
    <form className="rv-form" onSubmit={(e) => void submit(e)} noValidate>
      <StarPicker value={rating} onChange={setRating} />
      <label className="rv-field">Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} minLength={TITLE_MIN} required autoComplete="off" />
      </label>
      <label className="rv-field">Your review
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={BODY_MAX} minLength={BODY_MIN} required />
        <small>{body.length}/{BODY_MAX}. Please do not include phone numbers, addresses or medical advice for others.</small>
      </label>
      {room > 0 && (
        <label className="rv-field">Photos (optional, up to {room}, JPEG, PNG or WebP, under 2 MB each)
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, room))} />
        </label>
      )}
      {error && <p className="rv-error" role="alert">{error}</p>}
      <div className="rv-actions">
        <button className="btn btn--sm" type="submit" disabled={busy}>{busy ? 'Sending…' : existing ? 'Save changes' : 'Submit review'}</button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function ReportButton({ review, signedIn }: { review: PublicReview; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('spam');
  const [msg, setMsg] = useState('');
  if (!signedIn) return <Link className="rv-link" to="/login">Sign in to report</Link>;
  if (msg) return <span className="rv-note" role="status">{msg}</span>;
  if (!open) return <button type="button" className="rv-link" onClick={() => setOpen(true)}>Report</button>;
  return (
    <span className="rv-report">
      <label>Reason <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>{REPORT_REASONS.map((r) => <option key={r} value={r}>{REPORT_REASON_LABELS[r]}</option>)}</select></label>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void reviewsApi.report(review.id, reason, '').then((r) => setMsg(r.ok ? r.data.message : r.message))}>Send report</button>
      <button type="button" className="rv-link" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

export default function ProductReviews({ slug }: { slug: string }) {
  const { user } = useSession();
  const [rating, setRating] = useState<number | null>(null);
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [items, setItems] = useState<PublicReview[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mine, setMine] = useState<{ eligible: boolean; review: OwnReview | null } | null>(null);
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    setState('loading');
    void reviewsApi.list(slug, rating, sort, page).then((r) => {
      if (!live) return;
      if (!r.ok) return setState('error');
      setStats(r.data.stats);
      setItems((prev) => (page === 1 ? r.data.items : [...prev, ...r.data.items]));
      setState('ready');
    });
    return () => { live = false; };
  }, [slug, rating, sort, page]);

  const loadMine = useCallback(async () => {
    if (!user) return setMine(null);
    const r = await reviewsApi.mine(slug);
    setMine(r.ok ? r.data : null);
  }, [user, slug]);
  useEffect(() => { void loadMine(); }, [loadMine]);

  const refresh = (message: string) => { setNotice(message); setWriting(false); setPage(1); setRating(null); void loadMine(); void reviewsApi.list(slug, null, sort, 1).then((r) => { if (r.ok) { setStats(r.data.stats); setItems(r.data.items); } }); };
  const total = stats?.count ?? 0;
  const hasMore = items.length < (rating ? stats?.distribution[String(rating) as '1'] ?? 0 : total);

  return (
    <section className="section rv" aria-labelledby="rv-h" id="reviews">
      <div className="wrap">
        <p className="eyebrow">Customer reviews</p>
        <h2 id="rv-h">What customers say.</h2>

        {stats && total > 0 ? (
          <div className="rv-summary">
            <div className="rv-avg">
              <strong>{stats.average?.toFixed(1)}</strong>
              <Stars value={stats.average ?? 0} label={`Average rating ${stats.average?.toFixed(1)} out of 5`} />
              <span>{total} {total === 1 ? 'review' : 'reviews'}</span>
            </div>
            <ul className="rv-dist" aria-label="Rating distribution">
              {([5, 4, 3, 2, 1] as const).map((n) => {
                const c = stats.distribution[String(n) as '1'];
                return (
                  <li key={n}>
                    <button type="button" className={rating === n ? 'on' : ''} aria-pressed={rating === n} onClick={() => { setRating(rating === n ? null : n); setPage(1); }}>
                      <span>{n} star</span><span className="rv-bar" aria-hidden="true"><i style={{ width: `${(c / total) * 100}%` }} /></span><span>{c}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : state === 'ready' ? (
          <p className="muted rv-empty">No reviews yet. Reviews come only from customers who have received this product.</p>
        ) : null}

        <div className="rv-own">
          {notice && <p className="rv-note" role="status">{notice}</p>}
          {!user && state !== 'loading' && <p className="muted"><Link to="/login">Sign in</Link> to review a product you have received.</p>}
          {user && mine?.review && !writing && (
            <div className="rv-yours">
              <p><strong>Your review</strong> — {{ PENDING: 'waiting for our team to check it', PUBLISHED: 'live', HIDDEN: 'hidden by our team', REJECTED: 'not published', WITHDRAWN: 'withdrawn' }[mine.review.status]}.{mine.review.status_reason ? ` Reason: ${mine.review.status_reason}` : ''}</p>
              {['PUBLISHED', 'PENDING', 'HIDDEN'].includes(mine.review.status) && mine.review.edit_count < 3 && <button className="btn btn--ghost btn--sm" onClick={() => setWriting(true)}>Edit</button>}
              {mine.review.status !== 'WITHDRAWN' && <button className="btn btn--ghost btn--sm" onClick={() => { if (window.confirm('Withdraw your review? You will not be able to post another for this product.')) void reviewsApi.withdraw(mine.review!.id).then((r) => (r.ok ? refresh('Your review was withdrawn.') : setNotice(r.message))); }}>Withdraw</button>}
            </div>
          )}
          {user && mine?.eligible && !writing && <button className="btn btn--sm" onClick={() => setWriting(true)}>Write a review</button>}
          {user && mine && !mine.eligible && !mine.review && <p className="muted">You can review this product once an order of it has been delivered.</p>}
          {writing && <ReviewForm slug={slug} existing={mine?.review ?? null} onDone={refresh} onCancel={() => setWriting(false)} />}
        </div>

        {total > 0 && (
          <div className="rv-tools">
            <label>Sort <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="recent">Most recent</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option></select></label>
            {rating && <button className="rv-link" onClick={() => { setRating(null); setPage(1); }}>Clear {rating}-star filter</button>}
          </div>
        )}
        {state === 'error' && <p className="rv-error" role="alert">Reviews could not be loaded right now.</p>}
        <ul className="rv-list">
          {items.map((r) => (
            <li key={r.id} className="rv-item">
              <div className="rv-head"><Stars value={r.rating} label={`${r.rating} out of 5 stars`} /><strong>{r.title}</strong></div>
              <p className="rv-meta">{r.name} · <span className="rv-verified">Verified purchase</span> · {dateFmt.format(new Date(r.createdAt))}{r.edited ? ' · edited' : ''}</p>
              <p className="rv-body">{r.body}</p>
              {r.images.length > 0 && <div className="rv-photos">{r.images.map((f) => <img key={f} src={`/api/reviews/image?file=${f}`} alt={`Photo from ${r.name}`} loading="lazy" width="96" height="96" />)}</div>}
              {r.reply && <div className="rv-reply"><p className="rv-reply-label">Reply from Kaayra Herbals · {dateFmt.format(new Date(r.reply.at))}</p><p>{r.reply.body}</p></div>}
              <div className="rv-foot"><ReportButton review={r} signedIn={Boolean(user)} /></div>
            </li>
          ))}
        </ul>
        {hasMore && state === 'ready' && <button className="btn btn--ghost btn--sm" onClick={() => setPage((p) => p + 1)}>Show more reviews</button>}
      </div>
    </section>
  );
}
