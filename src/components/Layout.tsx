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
import { useSiteHints } from '../lib/siteHints';
import CartBadge from './cart/CartBadge';
import CartDrawer from './cart/CartDrawer';
import EmailLink from './EmailLink';
import KaayraAI from './KaayraAI';
import { usePresence } from '../lib/usePresence';
import LanguageSwitcher from './LanguageSwitcher';
import { useI18n, useT } from '../i18n/I18nProvider';
import type { MsgKey } from '../i18n/en';

const NAV: { to: string; label: MsgKey; note: MsgKey; end?: boolean }[] = [
  { to: '/collection', label: 'navShop', note: 'navShopNote' },
  { to: '/our-story', label: 'navStory', note: 'navStoryNote' },
  { to: '/founders', label: 'navFounders', note: 'navFoundersNote' },
  { to: '/our-approach', label: 'navApproach', note: 'navApproachNote' },
  { to: '/journal', label: 'navJournal', note: 'navJournalNote' },
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
  const t = useT();
  const { user } = useSession();
  const { enabled: cartEnabled } = useCart();
  // The bag's state is remembered from the last visit (siteHints.ts), so the announcement bar is right in the first frame.
  // On a first visit it is unknown: the bar keeps its height but stays empty until the server answers, instead of showing wording that then flips.
  const hints = useSiteHints();
  const bagState: boolean | undefined = hints.cartOpen ?? (cartEnabled ? true : undefined);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuMounted = usePresence(open, 240);
  useRouteMeta(pathname);

  // A new page must open at the top at once: the site sets `scroll-behavior: smooth`, which would otherwise make every
  // navigation visibly scroll up from wherever the reader was. Only a hash link within the same page scrolls smoothly.
  const lastPath = useRef(pathname);
  useEffect(() => {
    const samePage = lastPath.current === pathname;
    lastPath.current = pathname;
    setOpen(false);
    setSearching(false);
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: samePage ? 'smooth' : 'instant', block: 'start' });
        el.focus({ preventScroll: true });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
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

  // While the menu plays its exit animation it is inert: no focus, no clicks.
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = !open;
  }, [open, menuMounted]);

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
      <a className="skip-link" href="#main">{t('skip')}</a>
      <p className="announce" data-state={bagState === undefined ? 'pending' : 'ready'} aria-hidden={bagState === undefined ? true : undefined}>
        {bagState === undefined ? (
          <>&nbsp;</>
        ) : bagState ? (
          <>{t('announceLive')} <Link to="/collection">{t('announceShop')}</Link></>
        ) : (
          <>{t('announcePre')} <Link to="/#notify">{t('announceJoin')}</Link></>
        )}
      </p>
      <header className="site-header" data-scrolled={scrolled}>
        <div className="wrap header-bar">
          <button type="button" ref={toggleRef} className="menu-toggle" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)}>
            <span className="menu-icon" aria-hidden="true"><i /><i /></span>
            <span>{open ? t('close') : t('menu')}</span>
          </button>
          <Link to="/" className="brand" aria-label="Kaayra Herbals, home">
            <Logo kind="horizontal" className="brand-full" decorative priority />
            <Logo kind="icon" className="brand-icon" decorative priority />
          </Link>
          <nav className="nav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>{t(n.label)}</NavLink>
            ))}
          </nav>
          <div className="header-tools" onPointerEnter={() => void loadStatus()} onFocus={() => void loadStatus()}>
            <button type="button" className="tool" onClick={() => setSearching(true)} aria-haspopup="dialog" aria-label={t('searchProducts')}>
              <IconSearch />
              <span className="tool-label" aria-hidden="true">{t('search')}</span>
            </button>
            <span className="tool-account"><AccountMenu /></span>
            <CartBadge />
            <LanguageSwitcher />
          </div>
        </div>
        <div id="mobile-menu" ref={panelRef} className="mobile-menu" data-open={open} hidden={!menuMounted}>
          <div className="mobile-menu-head">
            <span className="mobile-menu-brand" aria-hidden="true"><Logo kind="horizontal" tone="dark" decorative /></span>
            <button type="button" className="mobile-close" onClick={() => { setOpen(false); toggleRef.current?.focus(); }}>
              <span>{t('close')}</span><IconClose />
            </button>
          </div>
          <p className="mobile-menu-title">{t('explore')}</p>
          <nav aria-label="Mobile primary" className="mobile-nav">
            {NAV.map((n, i) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <span className="mobile-nav-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="mobile-nav-text">
                  <span className="mobile-nav-label">{t(n.label)}</span>
                  <span className="mobile-nav-note">{t(n.note)}</span>
                </span>
                <span className="mobile-nav-arrow" aria-hidden="true"><IconArrow /></span>
              </NavLink>
            ))}
          </nav>
          <div className="mobile-account">
            {user ? (
              <>
                <Link to="/account" className="mobile-btn mobile-btn--solid"><IconUser /> {t('accountOf', { name: firstName(user) })}</Link>
                <Link to="/track-order" className="mobile-btn">{t('trackOrders')}</Link>
              </>
            ) : (
              <>
                <Link to="/login" className="mobile-btn">{t('signIn')}</Link>
                <Link to="/signup" className="mobile-btn mobile-btn--solid">{t('createAccount')}</Link>
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
  const { t, lang } = useI18n();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <p className="footer-mark"><Logo kind="horizontal" tone="dark" /></p>
          <p className="footer-deva" lang="hi" aria-hidden="true">काशी</p>
          <p className="footer-tag">{site.tagline}</p>
          <p className="footer-shloka">
            <span className="deva" lang="sa">सर्वे भवन्तु सुखिनः</span>
            <span className="footer-shloka-en">{t('shloka')}</span>
          </p>
          {lang !== 'en' && <p className="footer-autotr" data-no-translate>{t('autoNote')}</p>}
        </div>
        <div className="footer-grid">
          <div>
            <h2>{t('footerShop')}</h2>
            <ul>
              <li><Link to="/collection">{t('footerCollection')}</Link></li>
              <li><Link to="/ingredients">{t('footerIngredients')}</Link></li>
              <li><Link to="/bag">{t('footerBag')}</Link></li>
              <li><Link to="/track-order">{t('footerTrack')}</Link></li>
            </ul>
          </div>
          <div>
            <h2>{t('footerKaayra')}</h2>
            <ul>
              <li><Link to="/our-story">{t('footerStory')}</Link></li>
              <li><Link to="/founders">{t('footerFounders')}</Link></li>
              <li><Link to="/our-approach">{t('footerApproach')}</Link></li>
              <li><Link to="/journal">{t('footerJournal')}</Link></li>
              <li><Link to="/quality-and-transparency">{t('footerQuality')}</Link></li>
              <li><Link to="/product-development">{t('footerDev')}</Link></li>
              <li><Link to="/#notify">{t('footerJoin')}</Link></li>
            </ul>
          </div>
          <div>
            <h2>{t('footerLegal')}</h2>
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
              <li><Link to="/contact">{t('footerContact')}</Link></li>
              <li><Link to="/report-a-problem">{t('footerReport')}</Link></li>
              <li><Link to="/privacy">{t('footerPrivacy')}</Link></li>
              <li><Link to="/legal">{t('footerTerms')}</Link></li>
              <li><Link to="/medical-disclaimer">{t('footerMedical')}</Link></li>
            </ul>
          </div>
          <dl className="footer-company">
            <div><dt>{t('footerOperated')}</dt><dd>{company.legalName}</dd></div>
            <div><dt>{t('footerInc')}</dt><dd><time dateTime={company.incorporatedOn}>{company.incorporatedDisplay}</time></dd></div>
            <div><dt>{t('footerReg')}</dt><dd>{company.registeredLocation}</dd></div>
            <div><dt>{t('footerCin')}</dt><dd>{company.cin}</dd></div>
            <div><dt>{t('footerGstin')}</dt><dd>{company.gstin}</dd></div>
          </dl>
        </div>
        <div className="footer-bottom">
          <span>{t('footerRights', { year: new Date().getFullYear(), entity: site.legalEntity })}</span>
          <span>
            {enabled
              ? t('footerLive')
              : t('footerNotLive')}
          </span>
        </div>
      </div>
    </footer>
  );
}
