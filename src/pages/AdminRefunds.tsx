import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatInr } from '../../shared/orders';
import { REFUND_KINDS, REFUND_KIND_LABELS, REFUND_REASONS, REFUND_REASON_LABELS, REFUND_STATUSES, REFUND_STATUS_LABELS, nextRefundStatuses, rupeesToPaise, type Refund, type RefundStatus } from '../../shared/refunds';
import { Pager, api, errorText, useMe, usePaged, when } from '../lib/adminKit';

const BADGE: Record<RefundStatus, string> = { requested: 'badge badge--warn', approved: 'badge badge--warn', rejected: 'badge', refunded: 'badge' };

/** One refund with the owner's decision buttons. Rejecting asks for a reason; marking refunded asks for the payout reference. */
function RefundCard({ r, onExpired, onChanged }: { r: Refund; onExpired: () => void; onChanged: () => void }) {
  const me = useMe();
  const [pending, setPending] = useState<RefundStatus | null>(null);
  const [error, setError] = useState('');
  async function decide(e: FormEvent<HTMLFormElement>, status: RefundStatus) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await api('refund-status', { method: 'POST', body: { refund_id: r.id, status, note: String(f.get('note') ?? ''), payment_ref: String(f.get('payment_ref') ?? ''), goods_received: f.get('goods_received') === 'on' } });
    if (res.status === 401) return onExpired();
    if (!res.ok) return setError(errorText(res, 'Could not record the decision.'));
    setError('');
    setPending(null);
    onChanged();
  }
  const [goods, setGoods] = useState(false);
  const [paying, setPaying] = useState(false);
  /** Pays an approved refund back through Razorpay and marks it refunded with Razorpay's reference. */
  async function payThroughRazorpay() {
    if (!window.confirm(`Send ${formatInr(r.amount_paise)} back to the customer through Razorpay? This cannot be undone.`)) return;
    setPaying(true);
    const res = await api('refund-gateway', { method: 'POST', body: { refund_id: r.id, goods_received: goods } });
    setPaying(false);
    if (res.status === 401) return onExpired();
    if (!res.ok) return setError(errorText(res, 'Could not refund through Razorpay.'));
    setError('');
    onChanged();
  }
  const next = nextRefundStatuses(r.status);
  return (
    <li className="admin-message" data-status={r.status === 'refunded' || r.status === 'rejected' ? 'handled' : 'new'}>
      <div className="admin-message-head">
        <strong>{formatInr(r.amount_paise)}</strong>
        {r.orders && (
          <span>
            {r.orders.order_no} · {r.orders.customer_name}
          </span>
        )}
        <span className={BADGE[r.status]}>{REFUND_STATUS_LABELS[r.status]}</span>
        <time dateTime={r.requested_at}>{when(r.requested_at)}</time>
      </div>
      <p className="admin-message-body">
        {REFUND_KIND_LABELS[r.kind]} · {REFUND_REASON_LABELS[r.reason_code]}: {r.reason_note}
      </p>
      <p className="field-hint">
        Asked by {r.requested_by}
        {r.decided_by && ` · ${r.status === 'rejected' ? 'rejected' : 'approved'} by ${r.decided_by}${r.decision_note ? ` (${r.decision_note})` : ''}`}
        {r.status === 'refunded' && r.refunded_by && ` · paid out, reference ${r.payment_ref}${r.kind === 'return_and_refund' ? (r.goods_received ? ', goods received' : ', goods not yet received') : ''}`}
      </p>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {me.can('refunds.approve') && next.length > 0 && (
        <div className="admin-actions">
          {next.map((s) => (
            <button key={s} type="button" className={`btn btn--sm ${s === 'rejected' ? 'btn--ghost btn--danger' : ''}`} onClick={() => setPending(pending === s ? null : s)}>
              {s === 'approved' ? 'Approve' : s === 'rejected' ? 'Reject' : 'Mark refunded'}
            </button>
          ))}
        </div>
      )}
      {me.can('refunds.approve') && r.status === 'approved' && (
        <div className="admin-actions">
          {r.kind === 'return_and_refund' && (
            <label className="check">
              <input type="checkbox" checked={goods} onChange={(e) => setGoods(e.target.checked)} />
              Goods have come back
            </label>
          )}
          <button type="button" className="btn btn--sm" disabled={paying} onClick={() => void payThroughRazorpay()}>
            {paying ? 'Refunding…' : 'Refund through Razorpay'}
          </button>
          <span className="field-hint">For orders paid through Razorpay. If the customer paid another way, use Mark refunded and enter your bank reference.</span>
        </div>
      )}
      {pending && (
        <form className="inline-form" onSubmit={(e) => void decide(e, pending)}>
          {pending === 'rejected' && (
            <label>
              Reason for rejecting
              <input name="note" required minLength={3} maxLength={500} />
            </label>
          )}
          {pending === 'approved' && (
            <label>
              Note (optional)
              <input name="note" maxLength={500} />
            </label>
          )}
          {pending === 'refunded' && (
            <>
              <label>
                Bank or gateway reference
                <input name="payment_ref" required minLength={4} maxLength={80} />
              </label>
              {r.kind === 'return_and_refund' && (
                <label className="check">
                  <input type="checkbox" name="goods_received" /> Goods received back
                </label>
              )}
            </>
          )}
          <button className="btn btn--sm" type="submit">
            Confirm
          </button>
        </form>
      )}
    </li>
  );
}

/** Request form for one order: shows how much is still refundable and only appears for roles that may ask. */
interface RefundBasis {
  coupon_code: string | null; discount_paise: number; paid_paise: number; shipping_paise: number; remaining_paise: number;
  lines: { order_item_id: string; product: string; pack_size: string; qty: number; net_paise: number; discount_paise: number; unit_net_paise: number }[];
}

export function OrderRefunds({ orderId, onExpired }: { orderId: string; onExpired: () => void }) {
  const me = useMe();
  const [list, setList] = useState<Refund[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState<RefundBasis | null>(null);
  useEffect(() => {
    if (!open || basis) return;
    void api<{ basis: RefundBasis }>(`refund-basis?order=${orderId}`).then((r) => r.ok && r.data && setBasis(r.data.basis));
  }, [open, basis, orderId]);
  const load = useCallback(async () => {
    const r = await api<{ items: Refund[]; refundablePaise: number }>(`refunds?order_id=${orderId}`);
    if (r.status === 401) return onExpired();
    if (r.ok && r.data) {
      setList(r.data.items);
      setLeft(r.data.refundablePaise);
    } else setError(errorText(r, 'Could not load refunds.'));
  }, [orderId, onExpired]);
  useEffect(() => {
    void load();
  }, [load]);

  async function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const paise = rupeesToPaise(String(f.get('amount') ?? ''));
    if (paise === null) return setError('Enter the amount in rupees, for example 349 or 349.50.');
    const res = await api('refunds', { method: 'POST', body: { order_id: orderId, kind: f.get('kind'), reason_code: f.get('reason_code'), reason_note: String(f.get('reason_note') ?? ''), amount_paise: paise } });
    if (res.status === 401) return onExpired();
    if (!res.ok) return setError(errorText(res, 'Could not record the refund request.'));
    setError('');
    setOpen(false);
    await load();
  }

  if (list.length === 0 && !me.can('refunds.write')) return null;
  return (
    <>
      <h3 className="admin-subhead">Refunds and returns</h3>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {list.length > 0 && (
        <ul className="admin-messages">
          {list.map((r) => (
            <RefundCard key={r.id} r={r} onExpired={onExpired} onChanged={() => void load()} />
          ))}
        </ul>
      )}
      {me.can('refunds.write') && (
        <>
          <div className="admin-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(!open)} disabled={left === 0}>
              Request a refund
            </button>
            {left !== null && <span className="field-hint">Still refundable: {formatInr(left)}</span>}
          </div>
          {open && (
            <form className="inline-form" onSubmit={request}>
              <label>
                Type
                <select name="kind" defaultValue="refund_only">
                  {REFUND_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {REFUND_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reason
                <select name="reason_code" defaultValue="damaged">
                  {REFUND_REASONS.map((k) => (
                    <option key={k} value={k}>
                      {REFUND_REASON_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              {basis && basis.discount_paise > 0 && (
                <div className="field-hint" role="note">
                  <strong>Paid after coupon {basis.coupon_code}:</strong> refund what the customer actually paid, not the list price. Delivery paid: {formatInr(basis.shipping_paise)}.
                  <ul>
                    {basis.lines.map((l) => (
                      <li key={l.order_item_id}>{l.product} {l.pack_size} × {l.qty}: paid {formatInr(l.net_paise)} ({formatInr(l.discount_paise)} off), about {formatInr(l.unit_net_paise)} each</li>
                    ))}
                  </ul>
                </div>
              )}
              <label>
                Amount (₹)
                <input name="amount" required inputMode="decimal" placeholder="e.g. 349" />
              </label>
              <label>
                What happened
                <input name="reason_note" required minLength={3} maxLength={500} />
              </label>
              <button className="btn btn--sm" type="submit">
                Send for decision
              </button>
              <p className="field-hint">If the reason is a health concern after use, also log it under Issues and follow up directly; do not give medical advice here.</p>
            </form>
          )}
        </>
      )}
    </>
  );
}

/** All refunds across orders, newest first. Owners decide and record payouts here. */
export default function AdminRefunds({ onExpired }: { onExpired: () => void }) {
  const [status, setStatus] = useState<'all' | RefundStatus>('requested');
  const { page, setPage, data, error, loading, reload } = usePaged<Refund>(`refunds?status=${status}`, onExpired);
  return (
    <section aria-labelledby="refunds-title">
      <div className="admin-toolbar">
        <h1 id="refunds-title">Refunds and returns</h1>
        <div className="field admin-search">
          <label htmlFor="ref-status">Show</label>
          <select id="ref-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All</option>
            {REFUND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REFUND_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="field-hint">This is a record, not a payment. Pay the customer through your bank or gateway, then mark it refunded with the reference. Returned goods are not added back to stock automatically; check the seal, batch and expiry, then receive them in Inventory. Requests are made from the order itself.</p>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          {data.items.length === 0 && <p>No refunds {status === 'all' ? 'yet' : 'in this state'}.</p>}
          <ul className="admin-messages">
            {data.items.map((r) => (
              <RefundCard key={r.id} r={r} onExpired={onExpired} onChanged={() => void reload()} />
            ))}
          </ul>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </section>
  );
}
