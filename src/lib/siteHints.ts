import { useSyncExternalStore } from 'react';

/**
 * Last-known public state of the shop, remembered in this browser (localStorage).
 *
 * Why: three things on the page depend on a server answer that arrives after the first paint: whether the collection has
 * products (home hero buttons), whether the bag is open (announcement bar) and whether Kaayra AI is on (launcher button).
 * Without a memory, every reload first painted the wrong wording ("Join the launch list", "Nothing is for sale yet"),
 * then swapped it, and the AI button popped in late. With it, a returning visitor sees the right state in the first frame,
 * and the live answer from the server still replaces the memory, so it can never stay wrong for long.
 *
 * Only three yes/no facts are kept, no personal data. `undefined` means "not known yet" (first visit): callers then show
 * a quiet reserved space instead of guessing.
 *
 * Hydration: the server render and the first client render both use the empty snapshot (`getServerSnapshot`), so the
 * markup always matches. React then switches to the remembered snapshot straight away, before the next paint.
 */
export interface SiteHints {
  /** The shopping bag is open on this deployment. */
  cartOpen?: boolean;
  /** Kaayra AI is switched on. */
  aiOn?: boolean;
  /** The public collection has at least one product (`has`), and at least one can be bought (`sale`). */
  shop?: { has: boolean; sale: boolean };
}

const KEY = 'kaayra-site-hints-v1';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const EMPTY: SiteHints = Object.freeze({});

let snapshot: SiteHints | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): SiteHints {
  if (!raw) return EMPTY;
  try {
    const d: unknown = JSON.parse(raw);
    if (typeof d !== 'object' || d === null) return EMPTY;
    const o = d as { at?: unknown; cartOpen?: unknown; aiOn?: unknown; shop?: unknown };
    if (typeof o.at !== 'number' || Date.now() - o.at > MAX_AGE_MS || o.at > Date.now() + 60_000) return EMPTY;
    const out: SiteHints = {};
    if (typeof o.cartOpen === 'boolean') out.cartOpen = o.cartOpen;
    if (typeof o.aiOn === 'boolean') out.aiOn = o.aiOn;
    const s = o.shop as { has?: unknown; sale?: unknown } | null | undefined;
    if (s && typeof s === 'object' && typeof s.has === 'boolean' && typeof s.sale === 'boolean') out.shop = { has: s.has, sale: s.sale };
    return out;
  } catch {
    return EMPTY;
  }
}

function read(): SiteHints {
  try {
    return parse(window.localStorage.getItem(KEY));
  } catch {
    return EMPTY; // storage blocked (private mode): the page simply shows its quiet reserved state first
  }
}

function getSnapshot(): SiteHints {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    snapshot = parse(e.newValue);
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** Remember a fresh answer from the server. Does nothing (and does not re-render anything) if it is unchanged. */
export function setHint<K extends keyof SiteHints>(key: K, value: SiteHints[K]): void {
  if (typeof window === 'undefined') return;
  const cur = getSnapshot();
  if (JSON.stringify(cur[key]) === JSON.stringify(value)) return;
  snapshot = { ...cur, [key]: value };
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...snapshot, at: Date.now() }));
  } catch {
    /* storage full or blocked: the in-memory snapshot below still serves this visit */
  }
  listeners.forEach((fn) => fn());
}

/** The remembered state. Empty on the server and during hydration, so server and browser markup always match. */
export function useSiteHints(): SiteHints {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/** Test helper: forget everything held in memory (not storage). */
export function resetSiteHintsForTests(): void {
  snapshot = null;
}
