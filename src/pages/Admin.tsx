import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { passkeysSupported, signInWithPasskey } from '../lib/passkey';
import '../admin.css';
import '../admin-premium.css';
import { createPortal } from 'react-dom';
import { Icon } from '../lib/adminIcons';
import OAuthPanel from '../components/OAuthPanel';
const AdminProducts = lazy(() => import('./AdminProducts'));
const AdminInventory = lazy(() => import('./AdminInventory'));
const AdminOrders = lazy(() => import('./AdminOrders'));
const AdminAudit = lazy(() => import('./AdminAudit'));
import AdminHome, { attention, firstName, greeting, useHome } from './AdminHome';
const AdminRefunds = lazy(() => import('./AdminRefunds'));
const AdminShipments = lazy(() => import('./AdminShipments'));
const AdminDelivery = lazy(() => import('./AdminDelivery'));
const AdminCoupons = lazy(() => import('./AdminCoupons'));
const AdminBundles = lazy(() => import('./AdminBundles'));
const AdminReviews = lazy(() => import('./AdminReviews'));
const AdminRecovery = lazy(() => import('./AdminRecovery'));
const AdminIntelligence = lazy(() => import('./AdminIntelligence'));
const AdminMembers = lazy(() => import('./AdminMembers'));
const AdminAnalytics = lazy(() => import('./AdminAnalytics'));
const AdminFinance = lazy(() => import('./AdminFinance'));
import { MfaGate, TeamPanel } from './AdminSecurity';
import { ISSUE_CATEGORIES, ISSUE_STATUSES, ISSUE_STATUS_LABELS, SEVERITIES, type IssueStatus, type Severity } from '../../shared/issues';
import { ROLE_LABELS, type Permission } from '../../shared/roles';
import { MeProvider, Pager, api, errorText, useMe, usePaged, when, type Me } from '../lib/adminKit';

type Tab = 'home' | 'members' | 'refunds' | 'subscribers' | 'messages' | 'issues' | 'products' | 'inventory' | 'orders' | 'shipments' | 'delivery' | 'coupons' | 'bundles' | 'recovery' | 'reviews' | 'intelligence' | 'audit' | 'team' | 'reports' | 'sales' | 'stockhealth' | 'bi' | 'biproducts' | 'bicosts' | 'biexpenses' | 'biinventory' | 'bicustomers';
type Auth =
  | { kind: 'checking' }
  | { kind: 'anon' }
  | { kind: 'unconfigured'; missing: string[] }
  | { kind: 'mfa'; email: string; step: 'verify' | 'enroll'; mfaAvailable: boolean; optional: boolean }
  | { kind: 'in'; me: Me };

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  status: 'pending' | 'confirmed' | 'unsubscribed';
  optin_method: 'double' | 'single_legacy' | 'member';
  consented_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  consent_text_version: string;
  created_at: string;
}
interface Message {
  id: string;
  name: string;
  email: string;
  message: string;
  status: 'new' | 'handled';
  created_at: string;
}
interface Issue {
  id: string;
  ref: string;
  category: string;
  summary: string;
  details: string;
  error_code: string | null;
  error_ref: string | null;
  page: string | null;
  contact_email: string | null;
  user_agent: string | null;
  status: IssueStatus;
  severity: Severity;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionReply {
  email: string;
  role: Me['role'];
  mfa: 'ok' | 'verify' | 'enroll';
  mfaMode: 'required' | 'optional';
  mfaAvailable: boolean;
  permissions: Permission[];
  commerceEnabled: boolean;
}

async function readSession(): Promise<Auth> {
  const r = await api<SessionReply>('session');
  if (r.status === 503 && r.data?.status === 'mfa_unavailable') return { kind: 'unconfigured', missing: ['The admin_mfa table (run supabase/roles_mfa_audit.sql) or ADMIN_MFA=optional'] };
  if (r.status === 503) return { kind: 'unconfigured', missing: (r.data as { missing?: string[] } | null)?.missing ?? [] };
  if (!r.ok || !r.data?.email) return { kind: 'anon' };
  const d = r.data;
  if (d.mfa !== 'ok') return { kind: 'mfa', email: d.email, step: d.mfa, mfaAvailable: d.mfaAvailable, optional: d.mfaMode === 'optional' };
  return { kind: 'in', me: { email: d.email, role: d.role, permissions: d.permissions, commerceEnabled: d.commerceEnabled } };
}

export default function Admin() {
  const [auth, setAuth] = useState<Auth>({ kind: 'checking' });
  const refresh = () => void readSession().then(setAuth);
  // Stable identities: pages put these in effect dependencies, so a new function each render would refetch their data.
  const expire = useCallback(() => {
    setAuth({ kind: 'anon' });
  }, []);
  const signOut = useCallback(async () => {
    await api('logout', { method: 'POST' });
    setAuth({ kind: 'anon' });
  }, []);

  // Label every table cell with its column heading so narrow screens can show each row as a stacked card (no sideways scroll).
  // Only tables that actually changed are touched, and the work is batched into one frame.
  useEffect(() => {
    const root = document.querySelector('.admin-shell');
    if (!root) return;
    const dirty = new Set<HTMLTableElement>();
    const labelTable = (t: HTMLTableElement) => {
      const heads = Array.from(t.querySelectorAll('thead th')).map((h) => (h.textContent ?? '').trim());
      t.querySelectorAll('tbody tr').forEach((tr) => {
        Array.from(tr.children).forEach((c, i) => {
          if (c instanceof HTMLElement && heads[i] && c.dataset.label !== heads[i]) c.dataset.label = heads[i];
        });
      });
    };
    const collect = (n: Node) => {
      const el = n instanceof Element ? n : n.parentElement;
      if (!el) return;
      const up = el.closest('table.admin-table');
      if (up) dirty.add(up as HTMLTableElement);
      else if (n instanceof Element) n.querySelectorAll('table.admin-table').forEach((t) => dirty.add(t as HTMLTableElement));
    };
    let raf = 0;
    const flush = () => {
      raf = 0;
      dirty.forEach((t) => t.isConnected && labelTable(t));
      dirty.clear();
    };
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.addedNodes.length === 0) continue; // removals never need labels
        collect(r.target);
        r.addedNodes.forEach(collect);
      }
      if (dirty.size && !raf) raf = window.requestAnimationFrame(flush);
    });
    root.querySelectorAll('table.admin-table').forEach((t) => dirty.add(t as HTMLTableElement));
    flush();
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    document.title = 'Admin | Kaayra Herbals';
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = 'noindex, nofollow';
    void readSession().then(setAuth);
  }, []);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return window.localStorage.getItem('kaayra-admin-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const chooseTheme = (t: 'light' | 'dark') => {
    setTheme(t);
    try {
      window.localStorage.setItem('kaayra-admin-theme', t);
    } catch {
      /* A browser that blocks storage simply forgets the choice. */
    }
  };

  return (
    <div className="admin-shell" data-theme={theme}>
      <header className="admin-bar">
        <span className="brand admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">K</span>
          <span className="admin-brand-text">
            <strong>Kaayra Herbals</strong>
            <small>Admin</small>
          </span>
        </span>
        <div id="admin-nav-slot" className="admin-nav-slot" />
        <div id="admin-tools-slot" className="admin-tools-slot" />
        {auth.kind === 'mfa' && (
          <div className="admin-tools-static">
            <span className="admin-user-email">{auth.email}</span>
            <button
              type="button"
              className="admin-signout"
              onClick={async () => {
                await api('logout', { method: 'POST' });
                setAuth({ kind: 'anon' });
              }}
            >
              <Icon name="logout" size={18} />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </header>
      <main id="main" className="admin-main">
        {auth.kind === 'checking' && <p role="status">Checking your session…</p>}
        {auth.kind === 'unconfigured' && (
          <div className="form-status form-status--info" role="status">
            <strong>Admin is not set up.</strong> The server is missing or has invalid settings. See the README and docs/VERCEL_SETUP.md, then redeploy.
            {auth.missing.length > 0 && (
              <ul>
                {auth.missing.map((m) => (
                  <li key={m}>
                    <code>{m}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {auth.kind === 'anon' && <Login onDone={refresh} />}
        {auth.kind === 'mfa' && <MfaGate email={auth.email} step={auth.step} available={auth.mfaAvailable} optional={auth.optional} onDone={refresh} onExpired={expire} />}
        {auth.kind === 'in' && (
          <MeProvider value={auth.me}>
            <Dashboard onExpired={expire} theme={theme} setTheme={chooseTheme} onSignOut={signOut} />
          </MeProvider>
        )}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const r = await api<{ email: string }>('login', { method: 'POST', body: { email: String(f.get('email') ?? ''), password: String(f.get('password') ?? '') } });
    setBusy(false);
    if (r.ok && r.data?.email) return onDone();
    setError(errorText(r, 'Could not sign in. Check your connection and try again.'));
  }

  async function passkey(form: HTMLFormElement | null) {
    if (busy) return;
    setBusy(true);
    setError('');
    const typed = form ? String(new FormData(form).get('email') ?? '').trim().toLowerCase() : '';
    const r = await signInWithPasskey(typed);
    setBusy(false);
    if (r.ok) return onDone();
    setError(r.message);
  }

  return (
    <form className="signup admin-login auth-surface" onSubmit={submit} aria-label="Admin sign in">
      <h1>Admin sign in</h1>
      <p className="muted">For authorised Kaayra administrators only. A passkey signs you in in one step; with a password you will be asked for a two-step code next.</p>
      {passkeysSupported() && (
        <div className="admin-passkey-login">
          <button type="button" className="btn admin-passkey-btn" disabled={busy} onClick={(e) => void passkey(e.currentTarget.form)}>
            {busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
          </button>
          <p className="field-hint">Uses your fingerprint, face or device PIN. You can type your email first, or leave it empty and choose a passkey.</p>
        </div>
      )}
      <OAuthPanel intent="admin" next="/admin" />
      <p className="auth-or" role="separator">or use your password</p>
      <div className="field">
        <label htmlFor="admin-email">Email address</label>
        <input id="admin-email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="admin-password">Password</label>
        <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
      <div aria-live="polite">{error && <p className="form-status form-status--error">{error}</p>}</div>
    </form>
  );
}

const TABS: { id: Tab; label: string; needs: Permission | null }[] = [
  { id: 'home', label: 'Overview', needs: null },
  { id: 'reports', label: 'Reports', needs: 'orders.read' },
  { id: 'sales', label: 'Sales', needs: 'orders.read' },
  { id: 'stockhealth', label: 'Stock health', needs: 'inventory.read' },
  { id: 'products', label: 'Products', needs: 'products.read' },
  { id: 'inventory', label: 'Stock', needs: 'inventory.read' },
  { id: 'orders', label: 'Orders', needs: 'orders.read' },
  { id: 'shipments', label: 'Shipments', needs: 'shipments.read' },
  { id: 'delivery', label: 'Delivery areas', needs: 'delivery.read' },
  { id: 'coupons', label: 'Coupons', needs: 'coupons.read' },
  { id: 'bundles', label: 'Bundles', needs: 'bundles.read' },
  { id: 'recovery', label: 'Cart recovery', needs: 'recovery.read' },
  { id: 'refunds', label: 'Refunds', needs: 'refunds.read' },
  { id: 'reviews', label: 'Reviews', needs: 'reviews.read' },
  { id: 'members', label: 'Members', needs: 'members.read' },
  { id: 'subscribers', label: 'Launch list', needs: 'subscribers.read' },
  { id: 'messages', label: 'Messages', needs: 'messages.read' },
  { id: 'issues', label: 'Problem reports', needs: 'issues.read' },
  { id: 'intelligence', label: 'Kaayra Intelligence', needs: null },
  { id: 'audit', label: 'Activity log', needs: 'audit.read' },
  { id: 'team', label: 'Security', needs: null },
  { id: 'bi', label: 'Overview', needs: 'finance.read' },
  { id: 'biproducts', label: 'Product profit', needs: 'finance.read' },
  { id: 'bicosts', label: 'Product costs', needs: 'finance.read' },
  { id: 'biexpenses', label: 'Expenses', needs: 'finance.read' },
  { id: 'biinventory', label: 'Inventory value', needs: 'finance.read' },
  { id: 'bicustomers', label: 'Customers', needs: 'finance.read' },
];

/** Eleven sections would be a wall of tabs, so they sit in five plain groups. Every section is still here. */
const GROUPS: { id: string; label: string; tabs: Tab[] }[] = [
  { id: 'home', label: 'Overview', tabs: ['home'] },
  { id: 'analytics', label: 'Analytics', tabs: ['reports', 'sales', 'stockhealth'] },
  { id: 'bi', label: 'Business Intelligence', tabs: ['bi', 'biproducts', 'bicosts', 'biexpenses', 'biinventory', 'bicustomers'] },
  { id: 'shop', label: 'Shop', tabs: ['products', 'inventory', 'orders', 'shipments', 'delivery', 'coupons', 'bundles', 'recovery', 'refunds'] },
  { id: 'people', label: 'People', tabs: ['members', 'subscribers'] },
  { id: 'inbox', label: 'Inbox', tabs: ['messages', 'issues', 'reviews'] },
  { id: 'ai', label: 'Kaayra Intelligence', tabs: ['intelligence'] },
  { id: 'settings', label: 'Settings', tabs: ['audit', 'team'] },
];

const TAB_INFO: Record<Tab, string> = {
  home: 'What needs attention today',
  reports: 'Revenue, orders and units with the previous period',
  sales: 'Channels, states and best sellers',
  stockhealth: 'Shelf health, expiry and cover',
  bi: 'Revenue, profit, forecast and targets from real orders and recorded costs',
  biproducts: 'Profit by product and pack size',
  bicosts: 'Cost per unit with full history',
  biexpenses: 'Record and review business expenses',
  biinventory: 'Stock value at cost and at selling price, expiry exposure',
  bicustomers: 'Repeat purchases and lifetime value (counts only)',
  products: 'Add and edit products, photos and packs',
  inventory: 'Stock levels, batches and expiry',
  orders: 'View and handle customer orders',
  shipments: 'Pack, ship and track parcels',
  delivery: 'PIN codes we deliver to, charges and free delivery',
  coupons: 'Discount codes, limits and results',
  bundles: 'Sets and kits sold together at a lower price',
  recovery: 'Reminders for saved bags: settings and results',
  refunds: 'Review and pay refunds',
  reviews: 'Moderate customer reviews, reply and see ratings',
  intelligence: 'AI business briefing, questions about your figures and draft content',
  members: 'Customer accounts',
  subscribers: 'Launch list sign-ups',
  messages: 'Contact form messages',
  issues: 'Problems reported by visitors',
  audit: 'Who did what and when',
  team: 'Team, roles and two-step sign-in',
};

type Menu = null | 'bell' | 'new' | 'user' | 'search';

/** The group icons in the side rail: one per group, the sections inside it are the tabs in the top bar. */
const GROUP_ICON: Record<string, string> = { home: 'grid', shop: 'products', people: 'members', inbox: 'messages', settings: 'settings', analytics: 'chart', bi: 'chart' };

function Dashboard({ onExpired, theme, setTheme, onSignOut }: { onExpired: () => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void; onSignOut: () => void }) {
  const me = useMe();
  const tabs = useMemo(() => TABS.filter((t) => t.needs === null || me.can(t.needs)), [me]);
  const has = (id: Tab) => tabs.some((t) => t.id === id);
  const groups = useMemo(() => {
    const ok = (id: Tab) => tabs.some((t) => t.id === id);
    return GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter(ok) })).filter((g) => g.tabs.length > 0);
  }, [tabs]);
  const [tab, setTab] = useState<Tab>('home');
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  const { data: home, error: homeError } = useHome(onExpired, tab === 'home');
  const wait = useMemo(() => attention(home), [home]);

  useEffect(() => {
    setNavSlot(document.getElementById('admin-nav-slot'));
    setToolsSlot(document.getElementById('admin-tools-slot'));
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Keep the current section's tab in view when the row of tabs is wider than the bar.
    navSlot?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const row = navSlot?.querySelector<HTMLElement>('.admin-topnav');
    if (!row) return;
    const check = () => row.toggleAttribute('data-scroll', row.scrollWidth > row.clientWidth + 1);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [tab, navSlot]);
  // After sign-in, fetch the section code in idle time so the first click on any tab is instant.
  useEffect(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const run = () => {
      for (const id of ['products', 'inventory', 'orders', 'shipments', 'reports'] as Tab[]) if (has(id)) warm(id);
    };
    const h = ric ? ric(run, { timeout: 4000 }) : window.setTimeout(run, 1500);
    return () => {
      if (!ric) window.clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const warm = (id: Tab) => {
    const load: Partial<Record<Tab, () => Promise<unknown>>> = {
      products: () => import('./AdminProducts'),
      inventory: () => import('./AdminInventory'),
      orders: () => import('./AdminOrders'),
      shipments: () => import('./AdminShipments'),
      delivery: () => import('./AdminDelivery'),
      coupons: () => import('./AdminCoupons'),
      bundles: () => import('./AdminBundles'),
      recovery: () => import('./AdminRecovery'),
      refunds: () => import('./AdminRefunds'),
      reviews: () => import('./AdminReviews'),
      intelligence: () => import('./AdminIntelligence'),
      audit: () => import('./AdminAudit'),
      members: () => import('./AdminMembers'),
      reports: () => import('./AdminAnalytics'),
      sales: () => import('./AdminAnalytics'),
      stockhealth: () => import('./AdminAnalytics'),
      bi: () => import('./AdminFinance'),
      biproducts: () => import('./AdminFinance'),
      bicosts: () => import('./AdminFinance'),
      biexpenses: () => import('./AdminFinance'),
      biinventory: () => import('./AdminFinance'),
      bicustomers: () => import('./AdminFinance'),
    };
    void load[id]?.();
  };
  const label = (id: Tab) => TABS.find((t) => t.id === id)?.label ?? id;
  const group = groups.find((g) => g.tabs.includes(tab));
  const open = useCallback((id: string) => setTab(id as Tab), []);
  const badge = (gid: string): number => (gid === 'shop' ? wait.shop : gid === 'inbox' ? wait.inbox : 0);

  const nav = (
    <nav className="admin-topnav" aria-label={`${group?.label ?? 'Admin'} sections`}>
      {(group?.tabs ?? []).map((id) => (
        <button key={id} type="button" title={TAB_INFO[id]} aria-current={tab === id ? 'page' : undefined} onClick={() => open(id)} onPointerEnter={() => warm(id)} onFocus={() => warm(id)}>
          {label(id)}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="admin-layout">
      {navSlot && createPortal(nav, navSlot)}
      {toolsSlot && createPortal(<AdminTools tabs={tabs} wait={wait} me={me} onOpen={open} onSignOut={onSignOut} />, toolsSlot)}
      <div className="admin-rail-wrap">
        <div className="admin-rail admin-rail--theme" role="group" aria-label="Colour theme">
          <button type="button" data-tip="Light" aria-label="Light theme" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
            <Icon name="sun" />
          </button>
          <button type="button" data-tip="Dark" aria-label="Dark theme" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
            <Icon name="moon" />
          </button>
        </div>
        <nav className="admin-rail" aria-label="Admin areas">
          <ul>
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  data-tip={g.label}
                  aria-label={badge(g.id) > 0 ? `${g.label}, ${badge(g.id)} waiting` : g.label}
                  aria-current={group?.id === g.id ? 'page' : undefined}
                  onClick={() => open(g.tabs[0])}
                  onPointerEnter={() => warm(g.tabs[0])}
                  onFocus={() => warm(g.tabs[0])}
                >
                  <Icon name={GROUP_ICON[g.id] ?? 'grid'} />
                  {badge(g.id) > 0 && <span className="admin-count">{badge(g.id) > 99 ? '99+' : badge(g.id)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="admin-content">
        <div id={`panel-${tab}`} key={tab} className="admin-panel" aria-label={label(tab)} role="region" data-tab={tab}>
          <Suspense fallback={<div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}>
            {tab === 'home' && <AdminHome data={home} error={homeError} go={(t) => setTab(t as Tab)} />}
            {tab === 'reports' && <AdminAnalytics view="reports" onExpired={onExpired} go={(t) => setTab(t as Tab)} />}
            {tab === 'sales' && <AdminAnalytics view="sales" onExpired={onExpired} go={(t) => setTab(t as Tab)} />}
            {tab === 'stockhealth' && <AdminAnalytics view="stock" onExpired={onExpired} go={(t) => setTab(t as Tab)} />}
            {tab === 'bi' && <AdminFinance view="overview" onExpired={onExpired} />}
            {tab === 'biproducts' && <AdminFinance view="products" onExpired={onExpired} />}
            {tab === 'bicosts' && <AdminFinance view="costs" onExpired={onExpired} />}
            {tab === 'biexpenses' && <AdminFinance view="expenses" onExpired={onExpired} />}
            {tab === 'biinventory' && <AdminFinance view="inventory" onExpired={onExpired} />}
            {tab === 'bicustomers' && <AdminFinance view="customers" onExpired={onExpired} />}
            {tab === 'members' && <AdminMembers onExpired={onExpired} />}
            {tab === 'subscribers' && <Subscribers onExpired={onExpired} />}
            {tab === 'messages' && <Messages onExpired={onExpired} />}
            {tab === 'issues' && <Issues onExpired={onExpired} />}
            {tab === 'products' && <AdminProducts api={api} onExpired={onExpired} />}
            {tab === 'inventory' && <AdminInventory onExpired={onExpired} />}
            {tab === 'orders' && <AdminOrders onExpired={onExpired} />}
            {tab === 'shipments' && <AdminShipments onExpired={onExpired} />}
            {tab === 'delivery' && <AdminDelivery onExpired={onExpired} />}
            {tab === 'coupons' && <AdminCoupons onExpired={onExpired} />}
            {tab === 'bundles' && <AdminBundles onExpired={onExpired} />}
            {tab === 'recovery' && <AdminRecovery onExpired={onExpired} />}
            {tab === 'refunds' && <AdminRefunds onExpired={onExpired} />}
            {tab === 'reviews' && <AdminReviews onExpired={onExpired} />}
            {tab === 'intelligence' && <AdminIntelligence onExpired={onExpired} />}
            {tab === 'audit' && <AdminAudit onExpired={onExpired} />}
            {tab === 'team' && <TeamPanel onExpired={onExpired} />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

type Waiting = ReturnType<typeof attention>;

/** Search, notifications, "New" and the account menu. It owns its own open/typing state, so typing or opening a menu never re-renders the section underneath. */
const AdminTools = memo(function AdminTools({ tabs, wait, me, onOpen, onSignOut }: { tabs: { id: Tab; label: string; needs: Permission | null }[]; wait: Waiting; me: ReturnType<typeof useMe>; onOpen: (id: string) => void; onSignOut: () => void }) {
  const [menu, setMenu] = useState<Menu>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const has = (id: Tab) => tabs.some((t) => t.id === id);
  const open = (id: string) => {
    onOpen(id);
    setMenu(null);
    setQuery('');
  };
  const needle = query.trim().toLowerCase();
  const matches = needle ? tabs.filter((t) => `${t.label} ${TAB_INFO[t.id]}`.toLowerCase().includes(needle)) : [];
  const quick = ([
    ['products', 'Add a product', 'products.create'],
    ['inventory', 'Add stock', 'inventory.write'],
    ['coupons', 'Create a coupon', 'coupons.write'],
    ['delivery', 'Add a delivery area', 'delivery.write'],
  ] as const).filter(([, , perm]) => me.can(perm));
  const initials = (me.email.split('@')[0] ?? '').split(/[._+-]+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || me.email.charAt(0).toUpperCase();

  // Ctrl/Cmd+K jumps to the search box; Escape and a click elsewhere close any open menu.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        setMenu('search');
      } else if (e.key === 'Escape') {
        setMenu(null);
      }
    };
    const click = (e: MouseEvent) => {
      if (barRef.current && e.target instanceof Node && !barRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', click);
    };
  }, []);

  return (
    <div className="admin-tools" ref={barRef}>
      <div className="admin-search" role="search">
        <Icon name="search" size={18} />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search"
          aria-label="Search admin sections"
          autoComplete="off"
          onFocus={() => setMenu('search')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) open(matches[0].id);
          }}
        />
        <kbd aria-hidden="true">⌘K</kbd>
        {menu === 'search' && query.trim() && (
          <div className="admin-pop admin-pop--search" role="listbox" aria-label="Matching sections">
            {matches.length === 0 ? (
              <p className="admin-pop-empty">No section matches “{query.trim()}”.</p>
            ) : (
              matches.map((t) => (
                <button key={t.id} type="button" role="option" aria-selected="false" onClick={() => open(t.id)}>
                  <strong>{t.label}</strong>
                  <span>{TAB_INFO[t.id]}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {has('team') && (
        <button type="button" className="admin-round" aria-label="Security and settings" title="Security and settings" onClick={() => open('team')}>
          <Icon name="settings" size={19} />
        </button>
      )}
      <div className="admin-menu">
        <button type="button" className="admin-round" aria-label={wait.total > 0 ? `Notifications: ${wait.total} waiting` : 'Notifications'} aria-expanded={menu === 'bell'} onClick={() => setMenu(menu === 'bell' ? null : 'bell')}>
          <Icon name="bell" size={19} />
          {wait.total > 0 && <span className="admin-count">{wait.total > 99 ? '99+' : wait.total}</span>}
        </button>
        {menu === 'bell' && (
          <div className="admin-pop" role="menu" aria-label="Waiting for you">
            <p className="admin-pop-title">Waiting for you</p>
            {wait.items.length === 0 ? (
              <p className="admin-pop-empty">Everything is up to date.</p>
            ) : (
              wait.items.map((i) => (
                <button key={i.label} type="button" role="menuitem" onClick={() => open(i.to)}>
                  <span>{i.label}</span>
                  <strong>{i.count}</strong>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {quick.length > 0 && (
        <div className="admin-menu">
          <button type="button" className="admin-new" aria-expanded={menu === 'new'} onClick={() => setMenu(menu === 'new' ? null : 'new')}>
            <Icon name="plus" size={17} />
            <span>New</span>
          </button>
          {menu === 'new' && (
            <div className="admin-pop" role="menu" aria-label="Create new">
              {quick.map(([to, text]) => (
                <button key={to} type="button" role="menuitem" onClick={() => open(to)}>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="admin-menu">
        <button type="button" className="admin-user" aria-expanded={menu === 'user'} onClick={() => setMenu(menu === 'user' ? null : 'user')}>
          <span className="admin-avatar" aria-hidden="true">{initials}</span>
          <span className="admin-user-text">
            <span className="admin-user-hello">{greeting()}</span>
            <span className="admin-user-name">{firstName(me.email)}</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        {menu === 'user' && (
          <div className="admin-pop admin-pop--right" role="menu" aria-label="Account">
            <p className="admin-pop-title">{me.email}</p>
            <p className="admin-pop-sub">{ROLE_LABELS[me.role]}</p>
            <button type="button" role="menuitem" onClick={onSignOut}>
              <span>Sign out</span>
              <Icon name="logout" size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

function Subscribers({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setApplied(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const { page, setPage, data, error, loading, reload } = usePaged<Subscriber>(
    `subscribers${applied ? `?q=${encodeURIComponent(applied)}` : ''}`,
    onExpired,
  );

  async function remove(s: Subscriber) {
    if (!window.confirm(`Permanently delete ${s.email} from the launch list?`)) return;
    const r = await api(`subscribers?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
    if (r.status === 401) return onExpired();
    void reload();
  }

  return (
    <section aria-labelledby="subs-title">
      <div className="admin-toolbar">
        <h1 id="subs-title">Launch list</h1>
        <div className="field admin-search">
          <label htmlFor="subs-q">Search name or email</label>
          <input id="subs-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
        </div>
        {me.can('subscribers.export') && (
          <a className="btn btn--ghost btn--sm" href="/api/admin/export">
            Export CSV
          </a>
        )}
      </div>
      {error && <p className="form-status form-status--error">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Launch-list subscribers</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Consent given</th>
                  <th scope="col">Consent text</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={6}>{applied ? 'No subscribers match this search.' : 'No subscribers yet.'}</td>
                  </tr>
                )}
                {data.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.email}</td>
                    <td>{s.name ?? ''}</td>
                    <td>
                      {s.status === 'confirmed' ? `Confirmed ${when(s.confirmed_at ?? s.consented_at)}` : s.status === 'unsubscribed' ? `Unsubscribed ${when(s.unsubscribed_at ?? s.consented_at)}` : s.optin_method === 'single_legacy' ? 'Not confirmed (joined before confirmation existed)' : 'Awaiting confirmation'}
                    </td>
                    <td>{when(s.consented_at)}</td>
                    <td>{s.consent_text_version}</td>
                    <td>
                      {me.can('subscribers.delete') && (
                        <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => void remove(s)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function Messages({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [status, setStatus] = useState<'all' | 'new' | 'handled'>('new');
  const { page, setPage, data, error, loading, reload } = usePaged<Message>(`messages?status=${status}`, onExpired);

  async function mark(m: Message, next: 'new' | 'handled') {
    const r = await api(`messages?id=${encodeURIComponent(m.id)}`, { method: 'PATCH', body: { status: next } });
    if (r.status === 401) return onExpired();
    void reload();
  }
  async function remove(m: Message) {
    if (!window.confirm(`Permanently delete the message from ${m.name}?`)) return;
    const r = await api(`messages?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    if (r.status === 401) return onExpired();
    void reload();
  }

  return (
    <section aria-labelledby="msgs-title">
      <div className="admin-toolbar">
        <h1 id="msgs-title">Messages</h1>
        <div className="field admin-search">
          <label htmlFor="msg-status">Show</label>
          <select id="msg-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="new">New</option>
            <option value="handled">Handled</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>
      {error && <p className="form-status form-status--error">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          {data.items.length === 0 && <p>No messages here.</p>}
          <ul className="admin-messages">
            {data.items.map((m) => (
              <li key={m.id} className="admin-message" data-status={m.status}>
                <div className="admin-message-head">
                  <strong>{m.name}</strong>
                  <a href={`mailto:${m.email}`}>{m.email}</a>
                  <time dateTime={m.created_at}>{when(m.created_at)}</time>
                  <span className="badge">{m.status === 'new' ? 'New' : 'Handled'}</span>
                </div>
                <p className="admin-message-body">{m.message}</p>
                <div className="admin-actions">
                  {me.can('messages.update') && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void mark(m, m.status === 'new' ? 'handled' : 'new')}>
                      {m.status === 'new' ? 'Mark as handled' : 'Mark as new'}
                    </button>
                  )}
                  {me.can('messages.delete') && (
                    <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => void remove(m)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </section>
  );
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c.value, c.label]));

function IssueRow({ issue, onExpired, onChanged }: { issue: Issue; onExpired: () => void; onChanged: () => void }) {
  const me = useMe();
  const [status, setStatus] = useState<IssueStatus>(issue.status);
  const [severity, setSeverity] = useState<Severity>(issue.severity);
  const [note, setNote] = useState(issue.admin_note ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = status !== issue.status || severity !== issue.severity || note.trim() !== (issue.admin_note ?? '');

  async function save() {
    setBusy(true);
    setMessage('');
    const r = await api(`issues?id=${encodeURIComponent(issue.id)}`, { method: 'PATCH', body: { status, severity, admin_note: note } });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (!r.ok) {
      return setMessage(errorText(r, 'Could not save.'));
    }
    setMessage('Saved.');
    onChanged();
  }
  async function remove() {
    if (!window.confirm(`Permanently delete report ${issue.ref}?`)) return;
    const r = await api(`issues?id=${encodeURIComponent(issue.id)}`, { method: 'DELETE' });
    if (r.status === 401) return onExpired();
    onChanged();
  }

  return (
    <li className="admin-message admin-issue" data-status={issue.status} data-severity={issue.severity}>
      <div className="admin-message-head">
        <strong>{issue.ref}</strong>
        <time dateTime={issue.created_at}>{when(issue.created_at)}</time>
        <span className="badge">{CATEGORY_LABELS[issue.category] ?? issue.category}</span>
        {issue.error_code && <code>{issue.error_code}</code>}
        {issue.error_ref && <code>{issue.error_ref}</code>}
      </div>
      <p className="admin-issue-summary">{issue.summary}</p>
      <p className="admin-message-body">{issue.details}</p>
      <p className="muted admin-issue-meta">
        {issue.page && <span>Page: {issue.page}</span>}
        {issue.contact_email && (
          <span>
            Reply to: <a href={`mailto:${issue.contact_email}`}>{issue.contact_email}</a>
          </span>
        )}
        {issue.user_agent && <span title={issue.user_agent}>Browser: {issue.user_agent.slice(0, 60)}</span>}
      </p>
      <div className="admin-issue-controls">
        <div className="field">
          <label htmlFor={`st-${issue.id}`}>Status</label>
          <select id={`st-${issue.id}`} value={status} onChange={(e) => setStatus(e.target.value as IssueStatus)}>
            {ISSUE_STATUSES.map((v) => (
              <option key={v} value={v}>
                {ISSUE_STATUS_LABELS[v]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`sv-${issue.id}`}>Severity</label>
          <select id={`sv-${issue.id}`} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((v) => (
              <option key={v} value={v}>
                {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="field admin-issue-note">
          <label htmlFor={`nt-${issue.id}`}>Internal note</label>
          <textarea id={`nt-${issue.id}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="admin-actions">
        {me.can('issues.update') && (
          <button type="button" className="btn btn--sm" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        )}
        {me.can('issues.delete') && (
          <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => void remove()}>
            Delete
          </button>
        )}
        {message && <span role="status">{message}</span>}
      </div>
    </li>
  );
}

function Issues({ onExpired }: { onExpired: () => void }) {
  const [status, setStatus] = useState<'all' | IssueStatus>('open');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { page, setPage, data, error, loading, reload } = usePaged<Issue>(`issues?status=${status}${term ? `&q=${encodeURIComponent(term)}` : ''}`, onExpired);

  return (
    <section aria-labelledby="issues-title">
      <div className="admin-toolbar">
        <h1 id="issues-title">Issues</h1>
        <form
          className="admin-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
          }}
        >
          <div className="field admin-search">
            <label htmlFor="issue-status">Show</label>
            <select id="issue-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              {ISSUE_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {ISSUE_STATUS_LABELS[v]}
                </option>
              ))}
              <option value="all">All</option>
            </select>
          </div>
          <div className="field admin-search">
            <label htmlFor="issue-q">Search by summary, error code or reference</label>
            <input id="issue-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="KH-AUTH-001" />
          </div>
        </form>
      </div>
      {error && <p className="form-status form-status--error">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          {data.items.length === 0 && <p>No reports here.</p>}
          <ul className="admin-messages">
            {data.items.map((i) => (
              <IssueRow key={`${i.id}-${i.updated_at}`} issue={i} onExpired={onExpired} onChanged={() => void reload()} />
            ))}
          </ul>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </section>
  );
}
