import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LANGUAGES, languageOf } from '../../shared/languages';
import { preloadLanguage, useI18n } from '../i18n/I18nProvider';
import { usePresence } from '../lib/usePresence';
import { IconCheck, IconGlobe } from './Icons';

/**
 * Language picker: the last item at the top right of the header. The panel opens downwards and is right-aligned to the button,
 * which is itself the right-most item, so it can never extend past the edge of the screen; on phones it is at most the screen
 * width minus the page margins, and a long list scrolls inside the panel instead of growing the page.
 */
export default function LanguageSwitcher() {
  const { lang, language, loading, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const mounted = usePresence(open, 180);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !list.current) return;
      const items = [...list.current.querySelectorAll<HTMLButtonElement>('button')];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0 && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
      items[next]?.focus();
    };
    const onPointer = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    const onFocusOut = (e: FocusEvent) => { if (e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) close(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    const w = wrap.current;
    w?.addEventListener('focusout', onFocusOut);
    // Start on the chosen language, scrolled into view.
    list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: false });
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); w?.removeEventListener('focusout', onFocusOut); };
  }, [open, close, mounted]);

  const pick = (code: (typeof LANGUAGES)[number]['code']) => {
    if (code !== lang) setLang(code);
    close(true);
  };

  return (
    <div className="lang" ref={wrap}>
      <button
        type="button"
        ref={button}
        className="tool lang-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-pop`}
        aria-busy={loading}
        aria-label={`${t('language')}: ${language.name}`}
        data-loading={loading || undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGlobe />
        <span className="lang-code" aria-hidden="true">{language.code.toUpperCase()}</span>
      </button>
      {mounted && (
        <div id={`${id}-pop`} className="lang-pop" data-open={open} role="dialog" aria-label={t('chooseLanguage')}>
          <p className="lang-pop-title">{t('chooseLanguage')}</p>
          <ul className="lang-list" ref={list}>
            {LANGUAGES.map((l) => (
              <li key={l.code}>
                <button type="button" className="lang-opt" aria-current={l.code === lang ? 'true' : undefined} onClick={() => pick(l.code)} onPointerEnter={() => preloadLanguage(l.code)} onFocus={() => preloadLanguage(l.code)}>
                  <span className="lang-names">
                    <span className="lang-native" lang={l.code === 'en' ? 'en' : l.code} dir={l.rtl ? 'rtl' : undefined}>{l.native}</span>
                    {l.name !== l.native && <span className="lang-en">{l.name}</span>}
                    {l.ui !== l.code && <span className="lang-note">{t('interfaceIn', { lang: languageOf(l.ui).native })}</span>}
                  </span>
                  {l.code === lang && <span className="lang-tick"><IconCheck /></span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
