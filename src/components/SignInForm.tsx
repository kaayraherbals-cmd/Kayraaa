import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import PasswordField from './PasswordField';
import { authApi } from '../lib/auth';
import { failureInfo, type ErrorInfo } from '../lib/errors';
import ErrorNotice from './ErrorNotice';

export default function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await authApi<{ redirect?: string }>('login', 'POST', { email, password });
    if (r.ok && r.data?.redirect) {
      // Full navigation so the header and every page pick up the new session cleanly.
      window.location.assign(r.data.redirect);
      return;
    }
    setBusy(false);
    setPassword('');
    setError(failureInfo(r));
  }

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate={false} aria-busy={busy}>
      <div className="field">
        <label htmlFor="si-email">Email</label>
        <input id="si-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required disabled={busy} />
      </div>
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} />
      <p className="auth-switch">
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
      <div aria-live="polite">{error && <ErrorNotice error={error} />}</div>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
