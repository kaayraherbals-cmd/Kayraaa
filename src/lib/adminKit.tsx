import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Permission } from '../../shared/roles';

/** Shared plumbing for the admin screens: the API caller, paging, formatting and who is signed in. */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: (T & { message?: string; problems?: string[]; errorCode?: string; ref?: string; status?: string; hint?: string }) | null;
}
export interface Listing<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Short-lived memory of GET replies. Switching tabs paints the last answer at once, then refreshes it in the background. */
const CACHE_MS = 5 * 60_000;
const replies = new Map<string, { at: number; result: ApiResult<unknown> }>();
const pending = new Map<string, Promise<ApiResult<unknown>>>();

/** The last good reply for this path, if there is one. */
export function peek<T>(path: string): T | null {
  const hit = replies.get(path);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return (hit.result.data as T) ?? null;
}
/** Forget everything remembered (after any change, sign-out or an expired session). */
export function forgetReplies(): void {
  replies.clear();
  pending.clear();
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Kaayra-Admin'] = '1';
  } else {
    // The same GET asked for twice at once (two components, or a quick re-render) shares one request.
    const running = pending.get(path);
    if (running) return running as Promise<ApiResult<T>>;
  }
  const run = (async (): Promise<ApiResult<T>> => {
    try {
      const res = await fetch(`/api/admin/${path}`, { method, headers, credentials: 'same-origin', body: init.body === undefined ? undefined : JSON.stringify(init.body) });
      const data = (await res.json().catch(() => null)) as ApiResult<T>['data'];
      const result = { ok: res.ok, status: res.status, data };
      if (method !== 'GET') forgetReplies();
      else if (res.status === 401) forgetReplies();
      else if (res.ok) replies.set(path, { at: Date.now(), result });
      return result;
    } catch {
      return { ok: false, status: 0, data: null };
    }
  })();
  if (method === 'GET') {
    pending.set(path, run);
    void run.finally(() => {
      if (pending.get(path) === run) pending.delete(path);
    });
  }
  return run;
}

/** A readable message with its error code and reference, for any failed call. */
export function errorText(r: ApiResult<unknown>, fallback: string): string {
  const d = r.data;
  const base = d?.problems?.length ? `${d.message ?? fallback} ${d.problems.join(' ')}` : (d?.message ?? fallback);
  return `${base}${d?.hint ? ` ${d.hint}` : ''}${d?.errorCode ? ` (${d.errorCode}${d.ref ? `, ref ${d.ref}` : ''})` : ''}`;
}

const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
export const when = (iso: string): string => fmt.format(new Date(iso));
export const day = (isoDate: string): string => dayFmt.format(new Date(`${isoDate}T00:00:00+05:30`));

export interface Me {
  email: string;
  role: 'owner' | 'manager' | 'support';
  permissions: Permission[];
  commerceEnabled: boolean;
}
const MeContext = createContext<Me | null>(null);
export const MeProvider = MeContext.Provider;
export function useMe(): Me & { can: (p: Permission) => boolean } {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside the admin');
  // Memoised: screens list `me` in effect dependencies, and a fresh object on every render made them refetch in a loop.
  return useMemo(() => ({ ...me, can: (p: Permission) => me.permissions.includes(p) }), [me]);
}

export function usePaged<T>(base: string, onExpired: () => void) {
  const urlFor = (b: string, p: number) => `${b}${b.includes('?') ? '&' : '?'}page=${p}`;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Listing<T> | null>(() => peek<Listing<T>>(urlFor(base, 1)));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const expired = useRef(onExpired);
  const seq = useRef(0);
  useEffect(() => {
    expired.current = onExpired;
  });
  useEffect(() => {
    setPage(1);
  }, [base]);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const url = urlFor(base, page);
    const hit = peek<Listing<T>>(url);
    if (hit) setData(hit); // show the last answer straight away, refresh below
    setLoading(true);
    const r = await api<Listing<T>>(url);
    if (mine !== seq.current) return;
    setLoading(false);
    if (r.status === 401) return expired.current();
    if (!r.ok || !r.data) return setError(errorText(r, 'Could not load data.'));
    setError('');
    setData(r.data);
  }, [base, page]);
  useEffect(() => {
    void load();
  }, [load]);
  return { page, setPage, data, error, loading, reload: load };
}

/** The loading placeholder every admin screen uses, so a slow answer never shows a bare text line. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="admin-skeleton" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="admin-pager" aria-label="Pagination">
      <button type="button" className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {pages} ({total} total)
      </span>
      <button type="button" className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

/** Accessible confirmation for sensitive actions (native modal dialog: focus is trapped and Escape cancels). */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onCancel }: {
  open: boolean; title: string; children?: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="admin-dialog" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      {open && (
        <div className="admin-dialog-body">
          <h2 id="confirm-title">{title}</h2>
          <div>{children}</div>
          <div className="admin-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>Go back</button>
            <button type="button" className={`btn btn--sm ${danger ? 'btn--danger' : ''}`} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
