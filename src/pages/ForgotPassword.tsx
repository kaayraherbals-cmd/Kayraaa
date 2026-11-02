import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import { authApi, useNoIndex } from '../lib/auth';

export default function ForgotPassword() {
  useNoIndex('Reset your password | Kaayra Herbals');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await authApi('forgot', 'POST', { email });
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(r.data?.message ?? 'We could not reach the server. Please try again.');
  }

  return (
    <AuthShell>
      <div className="auth-card auth-surface">
        <div data-auth="1">
          <h1>Reset your password</h1>
          <p className="muted">Enter your email and we will send you a link to choose a new password.</p>
        </div>
        {sent ? (
          <div className="auth-form" role="status" data-auth="2">
            <p className="form-status form-status--ok">If an account exists for {email}, a reset link is on its way. It stays valid for one hour. Open it in this same browser.</p>
            <Link className="btn btn--ghost" to="/login">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy} data-auth="2">
            <div className="field">
              <label htmlFor="fp-email">Email</label>
              <input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required disabled={busy} />
            </div>
            <div aria-live="polite">{error && <p className="form-status form-status--error">{error}</p>}</div>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="auth-switch">
              <Link to="/login">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
