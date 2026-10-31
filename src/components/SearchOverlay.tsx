import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadProducts } from '../lib/products';
import type { PublicProduct } from '../../shared/products';
import { IconClose, IconSearch } from './Icons';
import { useT } from '../i18n/I18nProvider';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled])';

/** Product search as a modal dialog. Searches the approved catalogue the shop already loaded; "See all results" opens the collection filtered. */
export default function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const id = useId();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PublicProduct[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadProducts().then((p) => live && setItems(p ?? []));
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    document.documentElement.setAttribute('data-search-open', '');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      live = false;
      document.removeEventListener('keydown', onKey);
      document.documentElement.removeAttribute('data-search-open');
      opener?.focus?.();
    };
  }, [open, onClose]);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!items || term.length < 2) return [];
    return items.filter((p) => `${p.name} ${p.form} ${p.description}`.toLowerCase().includes(term)).slice(0, 6);
  }, [items, term]);

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onClose();
    navigate(term ? `/collection?q=${encodeURIComponent(q.trim())}` : '/collection');
  };

  return (
    <div className="search-layer">
      <div className="search-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="search-panel" role="dialog" aria-modal="true" aria-label={t('searchProducts')}>
        <form role="search" onSubmit={submit} className="search-form">
          <label htmlFor={`${id}-q`} className="sr-only">{t('searchProducts')}</label>
          <IconSearch />
          <input ref={input} id={`${id}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} autoComplete="off" enterKeyHint="search" />
          <button type="button" className="tool" onClick={onClose} aria-label={t('searchClose')}><IconClose /></button>
        </form>
        <div className="search-results" aria-live="polite">
          {term.length >= 2 && items && (results.length === 0 ? (
            <p className="search-empty">No products match “{q.trim()}”.</p>
          ) : (
            <>
              <p className="sr-only">{results.length} {results.length === 1 ? 'result' : 'results'}</p>
              <ul>
                {results.map((p) => (
                  <li key={p.slug}>
                    <Link to={`/collection/${p.slug}`} onClick={onClose}>
                      <span className="search-name">{p.name}</span>
                      <span className="search-meta">{p.form} · {(p.packSizes?.length ? p.packSizes : [p.packSize]).join(', ')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <button type="button" className="link-arrow" onClick={submit}>{t('searchAll')}</button>
            </>
          ))}
          {term.length < 2 && <p className="search-hint">{t('searchHintPre')}<Link to="/collection" onClick={onClose}>{t('searchHintLink')}</Link>{t('searchHintPost')}</p>}
        </div>
      </div>
    </div>
  );
}
