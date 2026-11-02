import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { errorMessage, loadStatus, oauthErrorCode, type AuthStatus } from '../lib/auth';
import ErrorNotice from './ErrorNotice';

type Intent = 'admin' | 'member';

const LABELS: Record<string, string> = { google: 'Google', github: 'GitHub', azure: 'Microsoft' };

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'google') {
    return (
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
        <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
    );
  }
  if (provider === 'github') {
    return (
      <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <path fill="#F25022" d="M1 1h9v9H1z" />
      <path fill="#7FBA00" d="M11 1h9v9h-9z" />
      <path fill="#00A4EF" d="M1 11h9v9H1z" />
      <path fill="#FFB900" d="M11 11h9v9h-9z" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="oauth-arrow" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

/**
 * The "Continue with…" panel. Buttons are plain links to /api/auth/start (the server runs the OAuth redirect), so the page
 * needs no provider script and works under the strict Content-Security-Policy. Clicking shows an instant pending state
 * while the browser navigates.
 */
export default function OAuthPanel({ intent, next, children }: { intent: Intent; next?: string; children?: ReactNode }) {
  // Google is shown immediately and never depends on the status call; other providers are added once it loads.
  const [status, setStatus] = useState<AuthStatus>({ providers: ['google'], signupOpen: true });
  const [pending, setPending] = useState<string | null>(null);
  const [errorCode] = useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('error')));

  useEffect(() => {
    let live = true;
    void loadStatus().then((s) => {
      // If the status call fails the Google button still shows; clicking it explains what is missing.
      if (live && s) setStatus({ ...s, providers: ['google', ...s.providers.filter((p) => p !== 'google')] });
    });
    // Drop ?error= from the address bar so a refresh does not show the same message again.
    if (errorCode && window.location.search) window.history.replaceState(null, '', window.location.pathname);
    // Coming back with the browser's Back button should not leave a button stuck in "Connecting".
    const reset = (e: PageTransitionEvent) => e.persisted && setPending(null);
    window.addEventListener('pageshow', reset);
    return () => {
      live = false;
      window.removeEventListener('pageshow', reset);
    };
  }, [errorCode]);

  const error = errorMessage(errorCode);

  return (
    <div className="oauth-panel" aria-busy={pending !== null}>
      {pending && <span className="auth-progress" aria-hidden="true" />}
      {error && (
        <ErrorNotice error={{ message: error, code: oauthErrorCode(errorCode) }} />
      )}
      {status.providers.length > 0 && (
        <ul className="oauth-list">
          {status.providers.map((p, i) => {
            const name = LABELS[p] ?? p;
            const href = `/api/auth/start?provider=${encodeURIComponent(p)}&intent=${intent}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
            const busy = pending === p;
            const content = (
              <>
                {busy ? <span className="spin" aria-hidden="true" /> : <ProviderIcon provider={p} />}
                <span>{busy ? `Connecting to ${name}…` : `Continue with ${name}`}</span>
                <Arrow />
              </>
            );
            return (
              <li key={p} style={{ ['--i' as string]: i } as CSSProperties}>
                <a
                  className="btn btn--ghost oauth-btn"
                  href={href}
                  data-pending={busy}
                  aria-disabled={pending !== null && !busy}
                  onClick={(e) => {
                    if (pending) return e.preventDefault();
                    setPending(p);
                  }}
                >
                  {content}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {children}
    </div>
  );
}
