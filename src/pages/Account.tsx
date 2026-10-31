import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi, useNoIndex, type SessionUser } from '../lib/auth';
import { cartApi } from '../lib/cartApi';
import { addressesFrom, day, refundLabel, rupees, statusLabel, useOrdersList, type OrderRow } from '../lib/orders';

const initials = (u: SessionUser) =>
  (u.name ?? u.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

const refundOf = (o: OrderRow) => o.order_refunds?.[0]?.status;

/** The customer's account: profile, recent orders, the delivery addresses used on them, and refund status. */
export default function Account() {
  useNoIndex('Your account | Kaayra Herbals');
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const orders = useOrdersList(1);
  const [remind, setRemind] = useState<{ available: boolean; on: boolean; text: string } | null>(null);
  const [remindMsg, setRemindMsg] = useState('');

  useEffect(() => {
    let live = true;
    void authApi<SessionUser>('session').then((r) => {
      if (!live) return;
      if (r.ok && r.data) setUser(r.data);
      else navigate('/login?return=/account', { replace: true });
    });
    return () => {
      live = false;
    };
  }, [navigate]);

  useEffect(() => {
    let live = true;
    void cartApi.prefs().then((r) => {
      if (live && r.ok) setRemind({ available: r.data.available, on: r.data.cartReminders, text: r.data.consentText });
    });
    return () => {
      live = false;
    };
  }, []);

  async function toggleRemind(on: boolean) {
    setRemindMsg('');
    const r = await cartApi.setPrefs(on);
    if (r.ok) {
      setRemind((x) => (x ? { ...x, on: r.data.cartReminders } : x));
      setRemindMsg(on ? 'Bag reminders are on.' : 'Bag reminders are off.');
    } else setRemindMsg(r.status === 409 ? 'We are not able to email this address. Please contact us if you think this is a mistake.' : 'Could not save that. Please try again.');
  }

  const items = useMemo(() => (orders.kind === 'ready' ? orders.data.items : []), [orders]);
  const addresses = useMemo(() => addressesFrom(items), [items]);
  const refunds = items.filter((o) => refundOf(o));

  async function signOut() {
    setBusy(true);
    await authApi('logout', 'POST');
    navigate('/', { replace: true });
  }

  async function remove() {
    if (!window.confirm('Permanently delete your account? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    const r = await authApi('delete-account', 'POST');
    if (r.ok) return navigate('/', { replace: true });
    setBusy(false);
    setError(r.data?.message ?? 'Could not delete your account. Please try again.');
  }

  if (!user) {
    return (
      <section className="section acc-section">
        <div className="wrap" role="status" aria-label="Loading your account" aria-busy="true">
          <span className="skel skel--round" /><span className="skel skel--line" /><span className="skel skel--line skel--short" />
        </div>
      </section>
    );
  }

  return (
    <section className="section acc-section">
      <div className="wrap">
        <header className="acc-head">
          <span className="avatar" aria-hidden="true">{initials(user)}</span>
          <div>
            <p className="eyebrow">Your account</p>
            <h1>{user.name ?? 'Welcome'}</h1>
            <p className="acc-mail">{user.email}{user.role === 'admin' ? ' · Administrator' : ''}</p>
          </div>
        </header>

        <div className="acc-grid">
          <section className="acc-card acc-card--wide" aria-labelledby="acc-orders">
            <div className="acc-card-head">
              <h2 id="acc-orders">Orders</h2>
              <Link className="link-arrow" to="/track-order">All orders</Link>
            </div>
            {orders.kind === 'loading' && <p role="status" aria-busy="true">Loading your orders…</p>}
            {orders.kind === 'error' && <p role="alert">{orders.message}</p>}
            {orders.kind === 'ready' && items.length === 0 && (
              <p className="muted">You have no orders yet. <Link className="link-arrow" to="/collection">Shop the collection</Link></p>
            )}
            {items.length > 0 && (
              <ul className="order-list">
                {items.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    <Link to={`/track-order/${o.id}`}>
                      <span className="order-no">{o.order_no}{o.is_test ? ' (test)' : ''}</span>
                      <span className="order-date">{day(o.created_at)}</span>
                      <span className="pill" data-status={o.status}>{statusLabel(o.status)}</span>
                      {refundOf(o) && <span className="pill pill--refund">{refundLabel(refundOf(o)!)}</span>}
                      <span className="order-total">{rupees(o.total_paise)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="acc-card" aria-labelledby="acc-addr">
            <h2 id="acc-addr">Delivery addresses</h2>
            {addresses.length === 0 ? (
              <p className="muted">Addresses you use at checkout will be listed here.</p>
            ) : (
              <>
                <ul className="addr-list">
                  {addresses.slice(0, 4).map((a) => (
                    <li key={`${a.address}|${a.pin}`}>
                      {a.name && <strong>{a.name}</strong>}
                      <span>{a.address}</span>
                      <span>PIN {a.pin}</span>
                    </li>
                  ))}
                </ul>
                <p className="acc-note">Taken from your recent orders. Enter the address you want at checkout.</p>
              </>
            )}
          </section>

          <section className="acc-card" aria-labelledby="acc-refunds">
            <h2 id="acc-refunds">Refunds</h2>
            {refunds.length === 0 ? (
              <p className="muted">No refund requests on your orders.</p>
            ) : (
              <ul className="addr-list">
                {refunds.map((o) => (
                  <li key={o.id}>
                    <Link to={`/track-order/${o.id}`}><strong>{o.order_no}</strong></Link>
                    <span>{refundLabel(refundOf(o)!)} · {rupees(o.order_refunds![0].amount_paise)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="acc-note">Problem with an order? <Link to="/contact">Contact us</Link> with your order number.</p>
          </section>

          {remind && (remind.available || remind.on) && (
            <section className="acc-card" aria-labelledby="acc-remind">
              <h2 id="acc-remind">Email reminders</h2>
              <label className="acc-note" style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={remind.on} onChange={(e) => void toggleRemind(e.target.checked)} />
                <span>{remind.text}</span>
              </label>
              <p className="acc-note" role="status">{remindMsg}</p>
            </section>
          )}

          <section className="acc-card acc-card--wide" aria-labelledby="acc-manage">
            <h2 id="acc-manage">Manage</h2>
            <div className="acc-actions">
              {user.role === 'admin' && <Link className="btn" to="/admin">Open admin panel</Link>}
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void signOut()}>Sign out</button>
              {user.role === 'member' && (
                <button type="button" className="btn btn--ghost btn--danger" disabled={busy} onClick={() => void remove()}>Delete my account</button>
              )}
            </div>
            <div aria-live="polite">{error && <p className="form-status form-status--error">{error}</p>}</div>
          </section>
        </div>
      </div>
    </section>
  );
}
