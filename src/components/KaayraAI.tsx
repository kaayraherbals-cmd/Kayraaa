import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { PublicProduct } from '../../shared/products';
import { aiChat, aiEnabled, aiWarm, type AiOrder, type AiTurn } from '../lib/aiApi';
import { loadProducts } from '../lib/products';
import ProductCard from './ProductCard';
import { useSiteHints } from '../lib/siteHints';
import { useI18n, type Translate } from '../i18n/I18nProvider';

interface Msg extends AiTurn { slugs?: string[]; orders?: AiOrder[]; needsSignIn?: boolean; handoff?: boolean; followUps?: string[]; /** Just arrived: its text is revealed smoothly once. Never kept. */ fresh?: boolean }

const STORE_KEY = 'kaayra-ai-chat-v2';
const MAX_KEPT = 24;

/** Suggested first questions that fit the page the visitor is on. */
function startersFor(pathname: string, t: Translate): string[] {
  const product = /^\/collection\/([^/]+)/.exec(pathname)?.[1];
  if (product) {
    const name = product.replace(/-/g, ' ');
    return [t('aiSP1', { name }), t('aiSP2', { name }), t('aiSP3'), t('aiS4')];
  }
  if (pathname.startsWith('/track-order') || pathname.startsWith('/account')) return [t('aiSO1'), t('aiSO2'), t('aiSO3'), t('aiS1')];
  return [t('aiS1'), t('aiS2'), t('aiS3'), t('aiS4')];
}

/** Safe, tiny formatting: **bold** and "- " lists only. Everything is built as React nodes, never as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
}
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={`u${blocks.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of text.split('\n')) {
    const m = /^\s*(?:[-•*]\s+)(.+)$/.exec(line);
    if (m && m[1]) bullets.push(m[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line.trim())}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

const reducedMotion = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The first n characters, cut only between whole letters (a conjunct or vowel sign in Indian scripts is several characters, and must not show half-built). */
function wholeLetters(text: string, n: number): string {
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return text.slice(0, n);
  let out = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (out.length + segment.length > n && out.length > 0) break;
    out += segment;
  }
  return out;
}

/** Shows a new answer smoothly (about a second at most) instead of all at once. Under reduced motion, or for answers already read, it shows everything. */
function Typed({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate && !reducedMotion() ? 0 : text.length);
  useEffect(() => {
    if (!animate || reducedMotion()) { setN(text.length); return; }
    let raf = 0;
    const start = performance.now();
    const dur = Math.min(900, Math.max(250, text.length * 6));
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setN(Math.ceil(p * text.length));
      if (p < 1) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [text, animate]);
  // While typing, a half-written **bold** is shown without its markers so no stray stars flash.
  const shown = n >= text.length ? text : wholeLetters(text, n).replace(/\*\*([^*]*)$/, '$1').replace(/\*$/, '');
  return <RichText text={shown} />;
}

/** A customer's own order, as stored in the shop's database (the server sends it; the model does not write it). */
function OrderCard({ order, onNavigate, t }: { order: AiOrder; onNavigate: () => void; t: Translate }) {
  return (
    <article className="kai-order" aria-label={t('aiOrder', { no: order.order_no })}>
      <header><strong>{order.order_no}</strong><span className="kai-order-status">{order.status}</span></header>
      <dl>
        <div><dt>{t('aiPlaced')}</dt><dd>{order.placed_on}</dd></div>
        <div><dt>{t('aiTotal')}</dt><dd>{order.total}</dd></div>
        {order.shipments.map((s, i) => (
          <Fragment key={i}>
            <div><dt>{t('aiDelivery')}</dt><dd>{s.status}{s.courier ? ` · ${s.courier}` : ''}</dd></div>
            {s.tracking_no && <div><dt>Tracking no.</dt><dd>{s.tracking_no}</dd></div>}
            {s.estimated_delivery && <div><dt>{t('aiExpected')}</dt><dd>{s.estimated_delivery}</dd></div>}
          </Fragment>
        ))}
        {order.refunds.map((x, i) => <div key={`r${i}`}><dt>{t('aiRefund')}</dt><dd>{x.status} · {x.amount}</dd></div>)}
      </dl>
      <Link to="/track-order" onClick={onNavigate} className="kai-link">{t('aiTrackThis')}</Link>
    </article>
  );
}

const Spark = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2c.6 4.9 2.6 7.4 7 8-4.4.6-6.4 3.1-7 8-.6-4.9-2.6-7.4-7-8 4.4-.6 6.4-3.1 7-8Zm7 12c.3 2.1 1.1 3 3 3.3-1.9.3-2.7 1.2-3 3.3-.3-2.1-1.1-3-3-3.3 1.9-.3 2.7-1.2 3-3.3Z" /></svg>
);

function loadSaved(): Msg[] {
  try {
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(STORE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((m): m is Msg => typeof m === 'object' && m !== null && (m as Msg).role !== undefined && typeof (m as Msg).text === 'string' && ((m as Msg).role === 'user' || (m as Msg).role === 'assistant'))
      .slice(-MAX_KEPT)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 1200), slugs: Array.isArray(m.slugs) ? m.slugs.filter((s) => typeof s === 'string').slice(0, 3) : undefined, handoff: m.handoff === true, followUps: Array.isArray(m.followUps) ? m.followUps.filter((s) => typeof s === 'string').slice(0, 3) : undefined }));
  } catch {
    return [];
  }
}

/**
 * Kaayra AI: a quiet shopping guide. It appears only when the server says AI is on, and never on the admin or checkout pages.
 * Recommendations are shown with the shop's own ProductCard (real price and stock from the server). The assistant cannot place orders.
 * Speed: the question appears at once, a live status shows while the answer is prepared, it can be stopped, and the server is warmed when
 * the panel opens. The conversation is kept for the browser session only (sessionStorage), never on the server.
 */
export default function KaayraAI() {
  const { pathname } = useLocation();
  const { t, lang } = useI18n();
  // On or off is remembered from the last visit, so a returning visitor has the button in the first frame. The server's live answer
  // then confirms or corrects it. A first visit has no memory, so the button appears as soon as that one small answer arrives.
  const hints = useSiteHints();
  const [live, setLive] = useState<boolean | undefined>(undefined);
  const enabled = live ?? hints.aiOn ?? false;
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(loadSaved);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState<{ message: string; retry: string } | null>(null);
  const [catalog, setCatalog] = useState<Map<string, PublicProduct>>(new Map());
  const input = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const lastAnswer = useRef<HTMLDivElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const warmed = useRef(false);
  const hidden = pathname.startsWith('/admin') || pathname.startsWith('/checkout') || pathname.startsWith('/pay');

  useEffect(() => {
    let alive = true;
    void aiEnabled().then((on) => { if (alive) setLive(on); }); // one small request, started at once (it used to wait 1.5 s)
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // Order details are shown now but never kept in the browser.
    try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-MAX_KEPT).map((m) => ({ ...m, orders: undefined, fresh: undefined })))); } catch { /* private mode: the chat simply is not kept */ }
  }, [msgs]);

  // Product cards: load the catalogue (already cached by the shop pages) when the panel opens or when a kept answer has cards.
  const needsCatalog = msgs.some((m) => (m.slugs?.length ?? 0) > 0);
  useEffect(() => {
    if (!open || !needsCatalog || catalog.size > 0) return;
    let live = true;
    void loadProducts().then((all) => { if (live && all) setCatalog(new Map(all.map((p) => [p.slug, p]))); });
    return () => { live = false; };
  }, [open, needsCatalog, catalog.size]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (!warmed.current) { warmed.current = true; aiWarm(); }
  }, [open]);

  // Scroll: a new answer is read from its first line; the visitor's own message and the waiting indicator stay at the bottom.
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const last = msgs[msgs.length - 1];
    if (!busy && last?.role === 'assistant' && lastAnswer.current) el.scrollTo({ top: Math.max(0, lastAnswer.current.offsetTop - 12), behavior: 'smooth' });
    else el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, error]);

  // Waiting indicator: seconds counter drives the status wording.
  useEffect(() => {
    if (!busy) { setWaited(0); return; }
    const t = window.setInterval(() => setWaited((w) => w + 1), 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  // Closing plays a short fade-out first, then removes the panel (instantly under reduced motion).
  const closeTimer = useRef<number | undefined>(undefined);
  const close = useCallback(() => {
    if (closeTimer.current !== undefined) return;
    const done = () => {
      closeTimer.current = undefined;
      setClosing(false);
      setOpen(false);
      setMsgs((m) => (m.some((x) => x.fresh) ? m.map((x) => (x.fresh ? { ...x, fresh: undefined } : x)) : m));
      opener.current?.focus();
    };
    if (reducedMotion()) return done();
    setClosing(true);
    closeTimer.current = window.setTimeout(done, 180);
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Warm the server as soon as the visitor shows interest in the launcher, so the first answer is quicker.
  const warmUp = () => { if (!warmed.current) { warmed.current = true; aiWarm(); } };

  const autosize = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  };
  useEffect(autosize, [text]);

  const send = async (raw: string, base: Msg[] = msgs) => {
    const message = raw.trim();
    if (!message || busy) return;
    setError(null);
    setText('');
    const history = base.map(({ role, text: body }) => ({ role, text: body }));
    setMsgs([...base, { role: 'user', text: message }]);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const r = await aiChat(message, history, ctl.signal, lang);
    abort.current = null;
    setBusy(false);
    if (!r.ok) {
      if (r.stopped) { setText(message); setMsgs(base); input.current?.focus(); return; }
      const wording: Partial<Record<string, string>> = { timeout: t('aiErrTimeout'), network: t('aiErrNetwork'), limited: t('aiErrLimited'), generic: t('aiErrGeneric'), invalid: t('aiErrGeneric') };
      return setError({ message: lang === 'en' || !r.kind ? r.message : (wording[r.kind] ?? r.message), retry: message });
    }
    if (r.products.length > 0 && catalog.size === 0) {
      const all = await loadProducts();
      if (all) setCatalog(new Map(all.map((p) => [p.slug, p])));
    }
    setMsgs((m) => [...m.map((x) => (x.fresh ? { ...x, fresh: undefined } : x)), { role: 'assistant', fresh: true, text: r.reply, slugs: r.products, orders: r.orders, needsSignIn: r.needsSignIn, handoff: r.handoff, followUps: r.followUps }]);
  };

  const retry = () => {
    if (!error) return;
    const again = error.retry;
    const withoutLast = msgs.slice(0, -1); // the failed question is the last message; it is sent again
    setError(null);
    void send(again, withoutLast);
  };
  const stop = () => abort.current?.abort();
  const reset = () => {
    abort.current?.abort();
    setMsgs([]);
    setError(null);
    setText('');
    input.current?.focus();
  };

  if (!enabled || hidden) return null;
  const lastAssistant = (() => { for (let i = msgs.length - 1; i >= 0; i -= 1) if (msgs[i]?.role === 'assistant') return i; return -1; })();
  const status = waited < 4 ? t('aiStatus1') : waited < 9 ? t('aiStatus2') : t('aiStatus3');
  const lastIsAssistant = msgs.length > 0 && msgs[msgs.length - 1]?.role === 'assistant' && !busy && !error;

  return (
    <div className={`kai${open ? ' kai--open' : ''}${closing ? ' kai--closing' : ''}`}>
      {open && (
        <section className={`kai-panel${closing ? ' kai-panel--out' : ''}`} role="dialog" aria-label={t('aiDialog')} id="kai-panel">
          <header className="kai-head">
            <span className="kai-avatar" aria-hidden="true">K</span>
            <div className="kai-title">
              <strong>Kaayra AI</strong>
              <span>{t('aiSub')}</span>
            </div>
            {msgs.length > 0 && <button type="button" className="kai-icon" onClick={reset} aria-label={t('aiNewAria')} title={t('aiNew')}>↺</button>}
            <button type="button" className="kai-icon" onClick={close} aria-label={t('aiCloseAria')}>×</button>
          </header>
          <div className="kai-log" ref={log} role="log" aria-live="polite" aria-relevant="additions">
            {msgs.length === 0 && (
              <div className="kai-intro">
                <p className="kai-hello">{t('aiHello')}</p>
                <p className="kai-sub">{t('aiIntro')}</p>
                <div className="kai-chips">{startersFor(pathname, t).map((s, i) => <button key={s} type="button" className="kai-chip" style={{ '--i': i } as CSSProperties} onClick={() => void send(s)}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => {
              const cards = (m.slugs ?? []).map((s) => catalog.get(s)).filter((p): p is PublicProduct => Boolean(p));
              return (
                <div key={i} className={`kai-msg kai-msg--${m.role}`} ref={i === lastAssistant ? lastAnswer : undefined}>
                  {m.role === 'assistant' ? <div className="kai-bubble"><Typed text={m.text} animate={m.fresh === true} /></div> : <p className="kai-bubble">{m.text}</p>}
                  {cards.length > 0 && <div className={`kai-cards${cards.length > 1 ? ' kai-cards--row' : ''}`}>{cards.map((p, ci) => <div key={p.slug} className="kai-card" style={{ '--i': ci } as CSSProperties}><ProductCard product={p} /></div>)}</div>}
                  {(m.orders?.length ?? 0) > 0 && <div className="kai-orders">{m.orders?.map((o) => <OrderCard key={o.order_no} order={o} onNavigate={close} t={t} />)}</div>}
                  {m.needsSignIn && <p className="kai-help"><Link to="/account" onClick={close}>{t('aiSignIn')}</Link>{t('aiSignInPost')}</p>}
                  {m.handoff && <p className="kai-help">{t('aiNeedPerson')}<Link to="/contact" onClick={close}>{t('aiContact')}</Link>.</p>}
                </div>
              );
            })}
            {busy && (
              <div className="kai-msg kai-msg--assistant" role="status">
                <div className="kai-bubble kai-wait"><span className="kai-dots" aria-hidden="true"><i /><i /><i /></span><span>{status}</span></div>
                <button type="button" className="kai-link" onClick={stop}>{t('aiStop')}</button>
              </div>
            )}
            {error && (
              <div className="kai-error" role="alert">
                <p>{error.message}</p>
                <button type="button" className="kai-link" onClick={retry}>{t('aiRetry')}</button>
              </div>
            )}
            {lastIsAssistant && (msgs[msgs.length - 1]?.followUps?.length ?? 0) > 0 && (
              <div className="kai-chips kai-chips--row" aria-label={t('aiSuggested')}>{msgs[msgs.length - 1]?.followUps?.map((s, i) => <button key={s} type="button" className="kai-chip" style={{ '--i': i } as CSSProperties} onClick={() => void send(s)}>{s}</button>)}</div>
            )}
          </div>
          <form className="kai-form" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <label htmlFor="kai-input" className="sr-only">{t('aiYourQuestion')}</label>
            <textarea id="kai-input" ref={input} value={text} maxLength={500} rows={1} placeholder={t('aiPlaceholder')} enterKeyHint="send" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
            <button type="submit" className="kai-send" disabled={busy || text.trim() === ''} aria-label={t('aiSend')}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" /></svg></button>
            {text.length > 400 && <span className="kai-count" aria-live="polite">{t('aiLeft', { n: 500 - text.length })}</span>}
          </form>
        </section>
      )}
      <button ref={opener} type="button" className="kai-launch" onPointerEnter={warmUp} onFocus={warmUp} onTouchStart={warmUp} aria-expanded={open} aria-controls="kai-panel" onClick={() => (open ? close() : setOpen(true))}>
        <Spark />
        <span>{open ? t('close') : t('aiLaunch')}</span>
      </button>
    </div>
  );
}
