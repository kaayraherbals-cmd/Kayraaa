import { useEffect } from 'react';

export type Role = 'admin' | 'member';
export interface SessionUser {
  email: string;
  name: string | null;
  role: Role;
}
export interface AuthStatus {
  providers: string[];
  signupOpen: boolean;
}

export type ApiResult<T> = { ok: boolean; status: number; data: (T & { message?: string; field?: string; code?: string; errorCode?: string; ref?: string }) | null };

export async function authApi<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/auth/${path}`, {
      method,
      headers:
        method === 'GET'
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'X-Kaayra-CSRF': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      credentials: 'same-origin',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as ApiResult<T>['data'];
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

let statusCache: { at: number; promise: Promise<AuthStatus | null> } | null = null;

/** Shared, 30-second cache so /login, /signup and the header hover prefetch all reuse one request. */
export function loadStatus(): Promise<AuthStatus | null> {
  if (statusCache && Date.now() - statusCache.at < 30_000) return statusCache.promise;
  const promise = authApi<AuthStatus>('status').then((r) => (r.ok && r.data ? r.data : null));
  statusCache = { at: Date.now(), promise };
  void promise.then((v) => {
    if (!v && statusCache?.promise === promise) statusCache = null;
  });
  return promise;
}

const MESSAGES: Record<string, string> = {
  signup_closed: 'We are not accepting new accounts right now.',
  not_admin: 'That account does not have administrator access.',
  unverified_email: 'We could not confirm a verified email address, so we could not sign you in.',
  provider_denied: 'Sign-in was cancelled. Nothing was changed.',
  expired: 'That link or sign-in attempt expired. Please try again.',
  other_browser: 'Your email is verified. Please sign in below with your email and password. (The link only signs you in on the browser where you started.)',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  bad_provider: 'That sign-in method is not available.',
  unconfigured: 'Sign-in is not set up yet.',
  server: 'Something went wrong on our side. Please try again.',
};

/** Catalogue code for each ?error= value the OAuth redirect can return (see shared/errors.ts). */
const OAUTH_CODES: Record<string, string> = {
  signup_closed: 'KH-AUTH-004',
  not_admin: 'KH-AUTH-015',
  unverified_email: 'KH-AUTH-009',
  provider_denied: 'KH-AUTH-007',
  expired: 'KH-AUTH-008',
  other_browser: 'KH-AUTH-013',
  rate_limited: 'KH-AUTH-003',
  bad_provider: 'KH-AUTH-014',
  unconfigured: 'KH-AUTH-010',
  server: 'KH-AUTH-011',
};

export function oauthErrorCode(code: string | null): string | undefined {
  return code ? (OAUTH_CODES[code] ?? OAUTH_CODES.server) : undefined;
}

export function errorMessage(code: string | null): string {
  return code ? (MESSAGES[code] ?? MESSAGES.server) : '';
}

/** Keeps private pages (sign-in, account) out of search results and sets their title. */
export function useNoIndex(title: string) {
  useEffect(() => {
    document.title = title;
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = 'noindex, nofollow';
  }, [title]);
}
