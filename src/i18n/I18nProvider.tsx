import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_LANG, isLangCode, languageOf, type LangCode, type Language, type Script } from '../../shared/languages';
import { en, type Messages, type MsgKey } from './en';
import { loadScriptFont, probe } from './fonts';
import { startPageTranslator } from './pageTranslator';
import { translateLines } from '../lib/translateApi';

/**
 * Website language. The prerendered HTML (what search engines read) is always English and the first render in the browser is English
 * too, so hydration always matches. After that the visitor's saved choice is applied: interface text, the script's font and the
 * page's lang attribute change together, only once everything for the language has loaded (no flash of the wrong font).
 */
const STORE = 'kaayra-lang';
const dictLoaders = import.meta.glob<{ default: Messages }>('./dict/*.ts');
const dictCache = new Map<string, Messages>();

/** Gets a language's interface text and font ready before it is chosen (called when the picker opens or an option is pointed at). */
export function preloadLanguage(code: string): void {
  if (!isLangCode(code) || code === DEFAULT_LANG) return;
  const l = languageOf(code);
  void loadDict(l.ui).catch(() => undefined);
  const f = loadScriptFont[l.script];
  if (f) void f().catch(() => undefined);
}

async function loadDict(ui: string): Promise<Messages> {
  if (ui === 'en') return en;
  const hit = dictCache.get(ui);
  if (hit) return hit;
  const loader = dictLoaders[`./dict/${ui}.ts`];
  if (!loader) return en;
  const m = (await loader()).default;
  dictCache.set(ui, m);
  return m;
}

/** Waits for the script font; never longer than 2.5 s, and an offline visitor simply gets the device's own font for the script. */
async function loadFont(script: Script): Promise<void> {
  const load = loadScriptFont[script];
  if (!load) return;
  try {
    await load();
    const p = probe[script];
    if (p && 'fonts' in document) await Promise.race([document.fonts.load(`400 1em "${p.family}"`, p.sample), new Promise((r) => window.setTimeout(r, 2500))]);
  } catch { /* keep going with system fonts */ }
}

export type Vars = Record<string, string | number>;
export type Translate = (key: MsgKey, vars?: Vars) => string;
export interface I18n {
  lang: LangCode;
  language: Language;
  /** True while a newly chosen language is still loading. */
  loading: boolean;
  setLang: (code: LangCode) => void;
  t: Translate;
}

const format = (s: string, vars?: Vars): string => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);
export const translator = (dict: Messages): Translate => (key, vars) => format(dict[key] ?? en[key], vars);

const Ctx = createContext<I18n>({ lang: DEFAULT_LANG, language: languageOf(DEFAULT_LANG), loading: false, setLang: () => undefined, t: translator(en) });
export const useI18n = (): I18n => useContext(Ctx);
export const useT = (): Translate => useContext(Ctx).t;

function applyToDocument(l: Language): void {
  const root = document.documentElement;
  root.lang = l.code === 'en' ? 'en-IN' : l.code;
  root.dataset.script = l.script;
  root.dataset.dir = l.rtl ? 'rtl' : 'ltr';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ lang: LangCode; dict: Messages }>({ lang: DEFAULT_LANG, dict: en });
  const [loading, setLoading] = useState(false);
  // The language being switched to. Page translation starts the moment it is chosen, in parallel with the font and interface text
  // loading, instead of waiting for them (that wait was most of the delay on the first switch).
  const [target, setTarget] = useState<LangCode>(DEFAULT_LANG);
  const seq = useRef(0);

  const choose = useCallback(async (code: LangCode, persist: boolean) => {
    const my = ++seq.current;
    const l = languageOf(code);
    setLoading(true);
    setTarget(l.code as LangCode);
    const [dict] = await Promise.all([loadDict(l.ui), loadFont(l.script)]);
    if (my !== seq.current) return; // a newer choice replaced this one
    applyToDocument(l);
    setState({ lang: l.code as LangCode, dict });
    setLoading(false);
    if (persist) { try { window.localStorage.setItem(STORE, l.code); } catch { /* private mode: the choice lasts for this visit only */ } }
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(STORE); } catch { /* ignore */ }
    if (isLangCode(saved) && saved !== DEFAULT_LANG) void choose(saved, false);
  }, [choose]);

  // Everything without a dictionary entry (page text, products, journal, legal, forms) is translated on the live page.
  useEffect(() => {
    if (target === DEFAULT_LANG) return;
    const engine = startPageTranslator(target, translateLines);
    return () => engine.stop();
  }, [target]);

  const setLang = useCallback((code: LangCode) => void choose(code, true), [choose]);
  const value = useMemo<I18n>(() => ({ lang: state.lang, language: languageOf(state.lang), loading, setLang, t: translator(state.dict) }), [state, loading, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
