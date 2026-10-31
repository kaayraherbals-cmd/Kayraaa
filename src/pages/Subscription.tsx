import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import { useNoIndex } from '../lib/auth';

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; title: string; text: string }
  | { kind: 'error'; message: string };

/**
 * Confirm or unsubscribe from the launch list. The link in the email only opens this page; nothing changes until the
 * person presses the button, so mail scanners that open links cannot confirm or unsubscribe anyone by accident.
 */
export default function Subscription() {
  useNoIndex('Launch list | Kaayra Herbals');
  const [params] = useSearchParams();
  const a = params.get('a');
  const action = a === 'unsubscribe' ? 'unsubscribe' : a === 'confirm' ? 'confirm' : a === 'cart-unsubscribe' ? 'cart-unsubscribe' : null;
  const token = params.get('t') ?? '';
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function run() {
    if (!action || !token || state.kind === 'busy') return;
    setState({ kind: 'busy' });
    try {
      const cart = action === 'cart-unsubscribe';
      const res = await fetch(cart ? '/api/cart/unsubscribe' : '/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kaayra-CSRF': '1' },
        body: JSON.stringify(cart ? { token } : { action, token }),
      });
      const data = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
      if (data?.status === 'confirmed') return setState({ kind: 'done', title: 'You are on the list', text: 'Thank you for confirming. We will write to you once, when Kaayra Herbals launches.' });
      if (data?.status === 'already_confirmed') return setState({ kind: 'done', title: 'Already confirmed', text: 'This address is already confirmed. No further action is needed.' });
      if (data?.status === 'was_unsubscribed') return setState({ kind: 'done', title: 'You have unsubscribed', text: data.message ?? 'You have unsubscribed since.' });
      if (data?.status === 'unsubscribed' && action === 'cart-unsubscribe') return setState({ kind: 'done', title: 'You are unsubscribed', text: 'We will not send bag reminder emails to this address. You can switch reminders back on in your account at any time.' });
      if (data?.status === 'unsubscribed') return setState({ kind: 'done', title: 'You are unsubscribed', text: 'We will not email this address about the launch. You can sign up again at any time from the homepage.' });
      setState({ kind: 'error', message: data?.message ?? 'Something went wrong. Please try again.' });
    } catch {
      setState({ kind: 'error', message: 'We could not reach the server. Please check your connection and try again.' });
    }
  }

  const invalid = !action || !token;
  return (
    <AuthShell>
      <div className="auth-card auth-surface">
        <div data-auth="1">
          <h1>{action === 'unsubscribe' || action === 'cart-unsubscribe' ? 'Unsubscribe' : 'Confirm your email'}</h1>
          {invalid ? (
            <p className="form-status form-status--error" role="alert">
              This link is incomplete. Please use the link in the email exactly as it was sent, or sign up again from the homepage.
            </p>
          ) : state.kind === 'done' ? (
            <div role="status">
              <p className="form-status form-status--ok">
                <strong>{state.title}.</strong> {state.text}
              </p>
            </div>
          ) : (
            <>
              <p className="muted">
                {action === 'cart-unsubscribe'
                  ? 'Press the button to stop bag reminder emails to this address.'
                  : action === 'unsubscribe'
                  ? 'Press the button to stop launch emails to this address.'
                  : 'Press the button to confirm that this email address should receive the Kaayra Herbals launch notification.'}
              </p>
              <button className="btn" type="button" onClick={run} disabled={state.kind === 'busy'}>
                {state.kind === 'busy' ? 'Working…' : action === 'unsubscribe' || action === 'cart-unsubscribe' ? 'Unsubscribe' : 'Confirm my email address'}
              </button>
              <div aria-live="polite">{state.kind === 'error' && <p className="form-status form-status--error">{state.message}</p>}</div>
            </>
          )}
          <p className="muted mt-15">
            <Link to="/">Back to the homepage</Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
