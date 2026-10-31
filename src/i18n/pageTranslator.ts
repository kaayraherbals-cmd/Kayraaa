import { TRANSLATE_LIMITS, parseRun, runTag, splitSpace, translatable } from '../../shared/translate';

/**
 * Translates everything on the page that has no hand-written dictionary entry: page text, product and ingredient names and
 * descriptions, journal, legal text, buttons, form labels, placeholders and image descriptions. It works on the live page after React has
 * drawn it, only when a visitor chose a language (the English page, and so what search engines read, is never touched), and it follows
 * the page as it changes (new route, product loaded, cart updated). Original English is kept so switching back restores it exactly.
 * Anything that fails stays in English; nothing is ever blanked.
 */
const SKIP = 'script,style,noscript,code,pre,textarea,svg,canvas,[translate="no"],[data-no-translate],[contenteditable="true"],.lang-pop';
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const;
type Attr = (typeof ATTRS)[number];
const INLINE = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'SPAN', 'SMALL', 'MARK', 'U', 'SUP', 'SUB']);
const STORE = 'kaayra-tr-';
const STORE_MAX_CHARS = 450_000;
// Request sizes for the first visit in a language (nothing saved yet): small and parallel, top of the page first.
const FIRST_ITEMS = 8;
const FIRST_CHARS = 900;
const BATCH_ITEMS = 14;
const BATCH_CHARS = 1800;
const PARALLEL = 6;

export interface Engine { stop: () => void }
type Fetcher = (lang: string, items: string[]) => Promise<(string | null)[] | null>;

interface Slot { get: () => string; set: (v: string) => void }

export function startPageTranslator(lang: string, fetcher: Fetcher, root: HTMLElement = document.body): Engine {
  const memo = new Map<string, string>(); // English -> translation
  const failedAt = new Map<string, number>();
  const inFlight = new Set<string>();
  const origText = new WeakMap<Text, string>();
  const lastText = new WeakMap<Text, string>();
  const origAttr = new WeakMap<Element, Partial<Record<Attr, string>>>();
  const lastAttr = new WeakMap<Element, Partial<Record<Attr, string>>>();
  const runOrig = new WeakMap<Element, { nodes: Node[]; inner: Map<Element, string> }>();
  const runValue = new WeakMap<Element, string>();
  const runApplied = new WeakMap<Element, string>(); // textContent right after we wrote the translation
  const badRuns = new Set<string>(); // sentences whose tags the model did not keep: translated piece by piece instead
  let timer = 0;
  let stopped = false;
  let saveTimer = 0;

  try {
    const raw = window.localStorage.getItem(STORE + lang);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) if (typeof v === 'string') memo.set(k, v);
  } catch { /* no saved translations: start empty */ }

  const save = (): void => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        let size = 0;
        const o: Record<string, string> = {};
        // Newest lines are last in the map; keep as many of them as fit.
        for (const [k, v] of [...memo.entries()].reverse()) { size += k.length + v.length + 6; if (size > STORE_MAX_CHARS) break; o[k] = v; }
        window.localStorage.setItem(STORE + lang, JSON.stringify(o));
      } catch { /* storage full or blocked: translations still work for this visit */ }
    }, 800);
  };

  const skipped = (el: Element | null): boolean => !el || Boolean(el.closest(SKIP));

  /** Every translatable place under `node`: text nodes and the listed attributes. */
  const collect = (node: Node, into: Slot[], keys: Set<string>): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      if (skipped(t.parentElement)) return;
      const now = t.nodeValue ?? '';
      // React (or anything else) wrote new text: that is the new English original.
      if (lastText.get(t) !== now) origText.set(t, now);
      const src = origText.get(t) ?? now;
      const { core } = splitSpace(src);
      if (!translatable(core)) return;
      keys.add(core);
      into.push({ get: () => core, set: (v) => { const { lead, trail } = splitSpace(src); const next = lead + v + trail; lastText.set(t, next); if (t.nodeValue !== next) t.nodeValue = next; } });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.matches(SKIP)) return;
    if (collectRun(el, into, keys)) return;
    for (const a of ATTRS) {
      const now = el.getAttribute(a);
      if (now === null) continue;
      const last = lastAttr.get(el)?.[a];
      if (last !== now) origAttr.set(el, { ...origAttr.get(el), [a]: now });
      const src = origAttr.get(el)?.[a] ?? now;
      const { core } = splitSpace(src);
      if (!translatable(core)) continue;
      keys.add(core);
      into.push({ get: () => core, set: (v) => { lastAttr.set(el, { ...lastAttr.get(el), [a]: v }); if (el.getAttribute(a) !== v) el.setAttribute(a, v); } });
    }
    if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) {
      const now = el.value;
      if (translatable(now)) { keys.add(now); into.push({ get: () => now, set: (v) => { el.value = v; } }); }
    }
    for (let c = el.firstChild; c; c = c.nextSibling) collect(c, into, keys);
  };


  /** A block whose children are only text and a few simple inline elements (each holding one text node) is translated as one sentence. */
  const collectRun = (el: Element, into: Slot[], keys: Set<string>): boolean => {
    const kids = [...el.childNodes];
    const inlines = kids.filter((c): c is Element => c.nodeType === Node.ELEMENT_NODE);
    if (inlines.length === 0 || inlines.length > 20) return false;
    const stale = runApplied.get(el) !== undefined && runApplied.get(el) !== el.textContent;
    const saved = stale ? undefined : runOrig.get(el);
    const src = saved ? saved.nodes : kids;
    const innerOf = (e: Element): string => (saved?.inner.get(e) ?? e.textContent ?? '');
    let idx = 0;
    const parts: string[] = [];
    const order: Element[] = [];
    for (const c of src) {
      if (c.nodeType === Node.TEXT_NODE) { parts.push((c as Text).nodeValue ?? ''); continue; }
      if (c.nodeType !== Node.ELEMENT_NODE) return false;
      const e = c as Element;
      if (!INLINE.has(e.tagName) || e.matches(SKIP) || e.querySelector('*')) return false;
      parts.push(runTag(idx, innerOf(e).replace(/\s+/g, ' ')));
      order.push(e); idx += 1;
    }
    const key = parts.join('').replace(/\s+/g, ' ').trim();
    if (!translatable(key) || badRuns.has(key)) return false;
    if (!saved) {
      const inner = new Map<Element, string>();
      order.forEach((e) => inner.set(e, e.textContent ?? ''));
      runOrig.set(el, { nodes: [...kids], inner });
    }
    keys.add(key);
    into.push({
      get: () => key,
      set: (v) => {
        if (runValue.get(el) === v && runApplied.get(el) === el.textContent) return;
        const parsed = parseRun(v, order.length);
        if (!parsed) { badRuns.add(key); schedule(0); return; }
        const next: Node[] = parsed.map((p) => {
          if (p.tag === null) return document.createTextNode(p.text);
          const e = order[p.tag] as Element;
          e.textContent = p.text;
          return e;
        });
        el.replaceChildren(...next);
        runValue.set(el, v);
        runApplied.set(el, el.textContent);
      },
    });
    return true;
  };

  const applyAll = (slots: Slot[]): void => {
    for (const s of slots) { const tr = memo.get(s.get()); if (tr) s.set(tr); }
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    // The owner's admin screens stay in English.
    if (window.location.pathname.startsWith('/admin')) return;
    const slots: Slot[] = [];
    const keys = new Set<string>();
    collect(root, slots, keys);
    applyAll(slots);
    const now = Date.now();
    const missing = [...keys].filter((k) => !memo.has(k) && !inFlight.has(k) && now - (failedAt.get(k) ?? 0) > 60_000);
    if (missing.length === 0) return;
    // Small requests answer fast: a model call takes time in proportion to how much it writes, so many small batches in parallel
    // finish far sooner than a few big ones. The first batch is the smallest (top of the page: header, hero) so it appears first.
    const batches: string[][] = [];
    let cur: string[] = [];
    let chars = 0;
    for (const k of missing) {
      const maxItems = batches.length === 0 ? FIRST_ITEMS : BATCH_ITEMS;
      const maxChars = batches.length === 0 ? FIRST_CHARS : BATCH_CHARS;
      if (cur.length >= Math.min(maxItems, TRANSLATE_LIMITS.maxItems) || (cur.length > 0 && chars + k.length > Math.min(maxChars, TRANSLATE_LIMITS.maxTotalChars))) { batches.push(cur); cur = []; chars = 0; }
      cur.push(k); chars += k.length;
    }
    if (cur.length) batches.push(cur);
    for (const b of batches) b.forEach((k) => inFlight.add(k));
    const doBatch = async (b: string[]): Promise<void> => {
      let res: (string | null)[] | null = null;
      try { res = await fetcher(lang, b); } catch { res = null; }
      const t = Date.now();
      b.forEach((k, i) => {
        inFlight.delete(k);
        const v = res?.[i];
        if (typeof v === 'string' && v.trim()) memo.set(k, v.trim()); else failedAt.set(k, t);
      });
      if (res) save();
      // Show this batch at once instead of waiting for the others.
      if (!stopped) { schedule(0); }
    };
    // At most PARALLEL requests at a time, in page order, so the top of the page is never queued behind the footer.
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < batches.length; i = next++) { if (stopped) { (batches[i] as string[]).forEach((k) => inFlight.delete(k)); continue; } await doBatch(batches[i] as string[]); }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, () => worker()));
  };

  const schedule = (ms: number): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { void run(); }, ms);
  };

  const observer = new MutationObserver((records) => {
    // Ignore our own writes (they equal what we last set); anything else needs a look.
    for (const r of records) {
      if (r.type === 'characterData' && r.target.nodeType === Node.TEXT_NODE && lastText.get(r.target as Text) === r.target.nodeValue) continue;
      if (r.type === 'attributes' && r.attributeName && lastAttr.get(r.target as Element)?.[r.attributeName as Attr] === (r.target as Element).getAttribute(r.attributeName)) continue;
      schedule(90);
      return;
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  document.documentElement.dataset.autotranslate = lang;
  schedule(0);

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(saveTimer);
      observer.disconnect();
      delete document.documentElement.dataset.autotranslate;
      // Put the English back exactly as it was.
      root.querySelectorAll('*').forEach((el) => {
        const r = runOrig.get(el);
        if (!r || runApplied.get(el) !== el.textContent) return;
        r.inner.forEach((txt, e) => { e.textContent = txt; });
        el.replaceChildren(...r.nodes);
      });
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n as Text;
        const o = origText.get(t);
        if (o !== undefined && lastText.get(t) === t.nodeValue) t.nodeValue = o;
      }
      root.querySelectorAll('*').forEach((el) => {
        const o = origAttr.get(el);
        if (!o) return;
        for (const a of ATTRS) if (o[a] !== undefined && lastAttr.get(el)?.[a] === el.getAttribute(a)) el.setAttribute(a, o[a] as string);
      });
    },
  };
}
