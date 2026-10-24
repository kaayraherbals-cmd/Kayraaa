import Logo from './Logo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import routes from '../../shared/routes.json';
import privateRoutes from '../../shared/private-routes.json';
import { INSTAGRAM_HANDLE, company, site, socialProfiles } from '../config/site';
import { loadStatus } from '../lib/auth';
import AccountMenu from './AccountMenu';
import SearchOverlay from './SearchOverlay';
import { IconArrow, IconClose, IconInstagram, IconSearch, IconUser } from './Icons';
import { useSession, firstName } from '../lib/session';
import { useCart } from '../lib/cart';
import CartBadge from './cart/CartBadge';
import CartDrawer from './cart/CartDrawer';
import EmailLink from './EmailLink';
import KaayraAI from './KaayraAI';

const NAV: { to: string; label: string; note: string; end?: boolean }[] = [
  { to: '/collection', label: 'Shop', note: 'The collection' },
  { to: '/our-story', label: 'Our Story', note: 'Where Kaayra began' },
  { to: '/founders', label: 'Founders', note: 'The people behind Kaayra' },
  { to: '/our-approach', label: 'Our Approach', note: 'How we work' },
  { to: '/journal', label: 'Journal', note: 'Notes and reading' },
];

function setMeta(selector: string, attr: string, value: string) {
  document.head.querySelector(selector)?.setAttribute(attr, value);
}

function useRouteMeta(pathname: string) {
  useEffect(() => {
    const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
    if (privateRoutes.some((r) => r.path === clean) || clean.startsWith('/collection/')) return; // these pages set their own title and noindex
    const meta = routes.find((r) => r.path === clean);
    const title = meta?.title ?? 'Page not found | Kaayra Herbals';
    document.title = title;
    if (meta) {
      setMeta('meta[name="description"]', 'content', meta.description);
      setMeta('meta[property="og:title"]', 'content', meta.title);
      setMeta('meta[property="og:description"]', 'content', meta.description);
      setMeta('link[rel="canonical"]', 'href', site.url + (clean === '/' ? '/' : clean));
      setMeta('meta[property="og:url"]', 'content', site.url + (clean === '/' ? '/' : clean));
    }
  }, [pathname]);
}

export default function Layout() {
  const { pathname, hash } = useLocation();
  const { user } = useSession();
  const { enabled: bagOpen } = useCart();
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useRouteMeta(pathname);

  useEffect(() => {
    setOpen(false);
    setSearching(false);
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView();
        el.focus({ preventScroll: true });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes the menu and hands focus back to the button that opened it. Tab stays inside the open menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the Close button when the menu opens.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('.mobile-close')?.focus();
  }, [open]);

  // While the mobile menu is open the page behind it does not scroll; it closes if the window grows to the desktop layout.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-menu-open', open);
    return () => document.documentElement.removeAttribute('data-menu-open');
  }, [open]);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 68rem)');
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const closeSearch = useCallback(() => setSearching(false), []);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <p className="announce">
        {bagOpen ? (
          <>Formulated in Kashi · Check delivery to your PIN code on any product page · <Link to="/collection">Shop the collection</Link></>
        ) : (
          <>Pre-launch · our first formulations are in development and nothing is for sale yet · <Link to="/#notify">Join the launch list</Link></>
        )}
      </p>
      <header className="site-header" data-scrolled={scrolled}>
        <div className="wrap header-bar">
          <button type="button" ref={toggleRef} className="menu-toggle" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)}>
            <span className="menu-icon" aria-hidden="true"><i /><i /></span>
            <span>{open ? 'Close' : 'Menu'}</span>
          </button>
          <Link to="/" className="brand" aria-label="Kaayra Herbals, home">
            <Logo />
          </Link>
          <nav className="nav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="header-tools" onPointerEnter={() => void loadStatus()} onFocus={() => void loadStatus()}>
            <button type="button" className="tool" onClick={() => setSearching(true)} aria-haspopup="dialog" aria-label="Search products">
              <IconSearch />
              <span className="tool-label" aria-hidden="true">Search</span>
            </button>
            <span className="tool-account"><AccountMenu /></span>
            <CartBadge />
          </div>
        </div>
        <div id="mobile-menu" ref={panelRef} className="mobile-menu" data-open={open} hidden={!open}>
          <div className="mobile-menu-head">
            <span className="mobile-menu-brand" aria-hidden="true">Kaayra <em>Herbals</em></span>
            <button type="button" className="mobile-close" onClick={() => { setOpen(false); toggleRef.current?.focus(); }}>
              <span>Close</span><IconClose />
            </button>
          </div>
          <p className="mobile-menu-title">Explore</p>
          <nav aria-label="Mobile primary" className="mobile-nav">
            {NAV.map((n, i) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <span className="mobile-nav-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="mobile-nav-text">
                  <span className="mobile-nav-label">{n.label}</span>
                  <span className="mobile-nav-note">{n.note}</span>
                </span>
                <span className="mobile-nav-arrow" aria-hidden="true"><IconArrow /></span>
              </NavLink>
            ))}
          </nav>
          <div className="mobile-account">
            {user ? (
              <>
                <Link to="/account" className="mobile-btn mobile-btn--solid"><IconUser /> {firstName(user)}’s account</Link>
                <Link to="/track-order" className="mobile-btn">Track orders</Link>
              </>
            ) : (
              <>
                <Link to="/login" className="mobile-btn">Sign in</Link>
                <Link to="/signup" className="mobile-btn mobile-btn--solid">Create account</Link>
              </>
            )}
          </div>
          <div className="mobile-foot">
            <p className="mobile-foot-tag">{site.tagline}</p>
            <p className="mobile-foot-row">
              <span className="mobile-foot-deva" lang="hi" aria-hidden="true">काशी</span>
              {site.instagram && (
                <a href={site.instagram} rel="noopener noreferrer" target="_blank" aria-label={`Instagram ${INSTAGRAM_HANDLE} (opens in a new tab)`}>
                  <IconInstagram /><span>{INSTAGRAM_HANDLE}</span>
                </a>
              )}
            </p>
          </div>
        </div>
      </header>
      <SearchOverlay open={searching} onClose={closeSearch} />
      <main id="main" tabIndex={-1} key={pathname === '/signup' ? '/login' : pathname} className="page-enter">
        <Outlet />
      </main>
      {/* After <main> so the first heading in the document is the page's H1 (the drawer is a fixed overlay, so nothing moves). */}
      <CartDrawer />
      <KaayraAI />
      <Footer />
    </>
  );
}

function Footer() {
  const { enabled } = useCart();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <p className="footer-mark" aria-hidden="true">Kaayra</p>
          <p className="footer-deva" lang="hi" aria-hidden="true">काशी</p>
          <p className="footer-tag">{site.tagline}</p>
          <p className="footer-shloka">
            <span className="deva" lang="sa">सर्वे भवन्तु सुखिनः</span>
            <span className="footer-shloka-en">Sarve bhavantu sukhinah: may all be happy.</span>
          </p>
        </div>
        <div className="footer-grid">
          <div>
            <h2>Shop</h2>
            <ul>
              <li><Link to="/collection">The collection</Link></li>
              <li><Link to="/ingredients">Ingredient library</Link></li>
              <li><Link to="/bag">Your bag</Link></li>
              <li><Link to="/track-order">Track an order</Link></li>
            </ul>
          </div>
          <div>
            <h2>Kaayra</h2>
            <ul>
              <li><Link to="/our-story">Our story</Link></li>
              <li><Link to="/founders">Founders</Link></li>
              <li><Link to="/our-approach">Our approach</Link></li>
              <li><Link to="/journal">Journal</Link></li>
              <li><Link to="/quality-and-transparency">Quality and transparency</Link></li>
              <li><Link to="/product-development">Development status</Link></li>
              <li><Link to="/#notify">Join the launch list</Link></li>
            </ul>
          </div>
          <div>
            <h2>Contact and legal</h2>
            <ul>
              {site.email && <li><EmailLink email={site.email} /></li>}
              {site.phone && <li><a href={`tel:${site.phone.replace(/\s+/g, '')}`}>{site.phone}</a></li>}
              {site.address && <li>{site.address}</li>}
              {site.instagram && (
                <li><a href={site.instagram} rel="noopener noreferrer" target="_blank">Instagram {INSTAGRAM_HANDLE}</a></li>
              )}
              {socialProfiles.map((p) => (
                <li key={p.label}><a href={p.url} rel="noopener noreferrer" target="_blank">{p.label}</a></li>
              ))}
              <li><Link to="/contact">Contact</Link></li>
              <li><Link to="/report-a-problem">Report a problem</Link></li>
              <li><Link to="/privacy">Privacy Policy</Link></li>
              <li><Link to="/legal">Terms</Link></li>
              <li><Link to="/medical-disclaimer">Medical Disclaimer</Link></li>
            </ul>
          </div>
          <dl className="footer-company">
            <div><dt>Operated by</dt><dd>{company.legalName}</dd></div>
            <div><dt>Incorporated</dt><dd><time dateTime={company.incorporatedOn}>{company.incorporatedDisplay}</time></dd></div>
            <div><dt>Registered in</dt><dd>{company.registeredLocation}</dd></div>
            <div><dt>Corporate Identity Number</dt><dd>{company.cin}</dd></div>
          </dl>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {site.legalEntity}. All rights reserved.</span>
          <span>
            {enabled
              ? 'Educational information only, not medical advice. Read the label on the pack before use.'
              : 'Educational information only, not medical advice. Kaayra does not currently sell products or offer consultations.'}
          </span>
        </div>
      </div>
    </footer>
  );
}
