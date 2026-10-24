import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { PublicProduct } from '../../shared/products';
import { aiChat, aiEnabled, aiWarm, type AiOrder, type AiTurn } from '../lib/aiApi';
import { loadProducts } from '../lib/products';
import ProductCard from './ProductCard';

interface Msg extends AiTurn { slugs?: string[]; orders?: AiOrder[]; needsSignIn?: boolean; handoff?: boolean; followUps?: string[] }

const STORE_KEY = 'kaayra-ai-chat-v2';
const MAX_KEPT = 24;
const DEFAULT_STARTERS = ['Help me choose a product', 'Which products list their ingredients?', 'How do I track my order?', 'Do you deliver to my PIN code?'];

/** Suggested first questions that fit the page the visitor is on. */
function startersFor(pathname: string): string[] {
  const product = /^\/collection\/([^/]+)/.exec(pathname)?.[1];
  if (product) {
    const name = product.replace(/-/g, ' ');
    return [`Tell me about ${name}`, `What ingredients does ${name} list?`, 'Compare it with another product', 'Do you deliver to my PIN code?'];
  }
  if (pathname.startsWith('/track-order') || pathname.startsWith('/account')) return ['Where is my latest order?', 'Has my order shipped?', 'How do refunds work?', 'Help me choose a product'];
  return DEFAULT_STARTERS;
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

/** A customer's own order, as stored in the shop's database (the server sends it; the model does not write it). */
function OrderCard({ order, onNavigate }: { order: AiOrder; onNavigate: () => void }) {
  return (
    <article className="kai-order" aria-label={`Order ${order.order_no}`}>
      <header><strong>{order.order_no}</strong><span className="kai-order-status">{order.status}</span></header>
      <dl>
        <div><dt>Placed</dt><dd>{order.placed_on}</dd></div>
        <div><dt>Total</dt><dd>{order.total}</dd></div>
        {order.shipments.map((s, i) => (
          <Fragment key={i}>
            <div><dt>Delivery</dt><dd>{s.status}{s.courier ? ` · ${s.courier}` : ''}</dd></div>
            {s.tracking_no && <div><dt>Tracking no.</dt><dd>{s.tracking_no}</dd></div>}
            {s.estimated_delivery && <div><dt>Expected by</dt><dd>{s.estimated_delivery}</dd></div>}
          </Fragment>
        ))}
        {order.refunds.map((x, i) => <div key={`r${i}`}><dt>Refund</dt><dd>{x.status} · {x.amount}</dd></div>)}
      </dl>
      <Link to="/track-order" onClick={onNavigate} className="kai-link">Track this order</Link>
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
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
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
    const t = window.setTimeout(() => void aiEnabled().then(setEnabled), 1500); // after the page has loaded; one small request
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    // Order details are shown now but never kept in the browser.
    try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-MAX_KEPT).map((m) => ({ ...m, orders: undefined })))); } catch { /* private mode: the chat simply is not kept */ }
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

  const close = useCallback(() => {
    setOpen(false);
    opener.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

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
    const history = base.map(({ role, text: t }) => ({ role, text: t }));
    setMsgs([...base, { role: 'user', text: message }]);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const r = await aiChat(message, history, ctl.signal);
    abort.current = null;
    setBusy(false);
    if (!r.ok) {
      if (r.stopped) { setText(message); setMsgs(base); input.current?.focus(); return; }
      return setError({ message: r.message, retry: message });
    }
    if (r.products.length > 0 && catalog.size === 0) {
      const all = await loadProducts();
      if (all) setCatalog(new Map(all.map((p) => [p.slug, p])));
    }
    setMsgs((m) => [...m, { role: 'assistant', text: r.reply, slugs: r.products, orders: r.orders, needsSignIn: r.needsSignIn, handoff: r.handoff, followUps: r.followUps }]);
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
  const status = waited < 4 ? 'Looking through our products…' : waited < 9 ? 'Putting your answer together…' : 'Almost there, thank you for waiting…';
  const lastIsAssistant = msgs.length > 0 && msgs[msgs.length - 1]?.role === 'assistant' && !busy && !error;

  return (
    <div className={`kai${open ? ' kai--open' : ''}`}>
      {open && (
        <section className="kai-panel" role="dialog" aria-label="Kaayra AI shopping assistant" id="kai-panel">
          <header className="kai-head">
            <span className="kai-avatar" aria-hidden="true">K</span>
            <div className="kai-title">
              <strong>Kaayra AI</strong>
              <span>Shopping guide · not medical advice</span>
            </div>
            {msgs.length > 0 && <button type="button" className="kai-icon" onClick={reset} aria-label="Start a new conversation" title="New conversation">↺</button>}
            <button type="button" className="kai-icon" onClick={close} aria-label="Close assistant">×</button>
          </header>
          <div className="kai-log" ref={log} role="log" aria-live="polite" aria-relevant="additions">
            {msgs.length === 0 && (
              <div className="kai-intro">
                <p className="kai-hello">Namaste. How can I help?</p>
                <p className="kai-sub">Ask about our products, ingredients, your order, or how to use the site.</p>
                <div className="kai-chips">{startersFor(pathname).map((s) => <button key={s} type="button" className="kai-chip" onClick={() => void send(s)}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => {
              const cards = (m.slugs ?? []).map((s) => catalog.get(s)).filter((p): p is PublicProduct => Boolean(p));
              return (
                <div key={i} className={`kai-msg kai-msg--${m.role}`} ref={i === lastAssistant ? lastAnswer : undefined}>
                  {m.role === 'assistant' ? <div className="kai-bubble"><RichText text={m.text} /></div> : <p className="kai-bubble">{m.text}</p>}
                  {cards.length > 0 && <div className={`kai-cards${cards.length > 1 ? ' kai-cards--row' : ''}`}>{cards.map((p) => <div key={p.slug} className="kai-card"><ProductCard product={p} /></div>)}</div>}
                  {(m.orders?.length ?? 0) > 0 && <div className="kai-orders">{m.orders?.map((o) => <OrderCard key={o.order_no} order={o} onNavigate={close} />)}</div>}
                  {m.needsSignIn && <p className="kai-help"><Link to="/account" onClick={close}>Sign in</Link> to see your orders here.</p>}
                  {m.handoff && <p className="kai-help">Need a person? <Link to="/contact" onClick={close}>Contact our team</Link>.</p>}
                </div>
              );
            })}
            {busy && (
              <div className="kai-msg kai-msg--assistant" role="status">
                <div className="kai-bubble kai-wait"><span className="kai-dots" aria-hidden="true"><i /><i /><i /></span><span>{status}</span></div>
                <button type="button" className="kai-link" onClick={stop}>Stop</button>
              </div>
            )}
            {error && (
              <div className="kai-error" role="alert">
                <p>{error.message}</p>
                <button type="button" className="kai-link" onClick={retry}>Try again</button>
              </div>
            )}
            {lastIsAssistant && (msgs[msgs.length - 1]?.followUps?.length ?? 0) > 0 && (
              <div className="kai-chips kai-chips--row" aria-label="Suggested questions">{msgs[msgs.length - 1]?.followUps?.map((s) => <button key={s} type="button" className="kai-chip" onClick={() => void send(s)}>{s}</button>)}</div>
            )}
          </div>
          <form className="kai-form" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <label htmlFor="kai-input" className="sr-only">Your question</label>
            <textarea id="kai-input" ref={input} value={text} maxLength={500} rows={1} placeholder="Ask a question" enterKeyHint="send" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
            <button type="submit" className="kai-send" disabled={busy || text.trim() === ''} aria-label="Send question"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" /></svg></button>
            {text.length > 400 && <span className="kai-count" aria-live="polite">{500 - text.length} left</span>}
          </form>
        </section>
      )}
      <button ref={opener} type="button" className="kai-launch" aria-expanded={open} aria-controls="kai-panel" onClick={() => (open ? close() : setOpen(true))}>
        <Spark />
        <span>{open ? 'Close' : 'Ask Kaayra AI'}</span>
      </button>
    </div>
  );
}
