import { useState, type FormEvent } from 'react';
import { failureInfo, type ErrorInfo } from '../lib/errors';
import ErrorNotice from './ErrorNotice';
import { Link } from 'react-router-dom';
import PasswordField, { passwordHint } from './PasswordField';
import { authApi } from '../lib/auth';

type Errors = Partial<Record<'name' | 'email' | 'password' | 'confirm' | 'consent' | 'form', string>>;

export default function CreateAccountForm({ onSignIn }: { onSignIn: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState<null | { verify: boolean; email: string }>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (password !== confirm) next.confirm = 'The two passwords do not match.';
    if (!consent) next.consent = 'Please agree to continue.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setFailure(null);
    const r = await authApi<{ verify?: boolean }>('register', 'POST', { name, email, password, confirm, consent });
    setBusy(false);
    if (r.ok) {
      setDone({ verify: r.data?.verify !== false, email });
      return;
    }
    const info = failureInfo(r);
    const field = r.data?.field;
    if (field === 'name' || field === 'email' || field === 'password' || field === 'consent') {
      setErrors({ [field]: info.message });
    } else {
      setErrors({});
      setFailure(info);
    }
  }

  if (done) {
    return (
      <div className="auth-form" role="status">
        <h2 className="auth-done-title">{done.verify ? 'Check your email' : 'Account created'}</h2>
        {done.verify ? (
          <p className="muted">
            We sent a verification link to <strong>{done.email}</strong>. Open it to finish creating your account, then sign in with your email and password. The link can
            take a minute to arrive. Check your spam folder if you do not see it.
          </p>
        ) : (
          <p className="muted">Your account is ready. You can sign in now.</p>
        )}
        <button type="button" className="btn" onClick={onSignIn}>
          Go to sign in
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
      <div className="field">
        <label htmlFor="su-name">Your name</label>
        <input id="su-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" minLength={2} maxLength={100} required disabled={busy} aria-invalid={errors.name ? true : undefined} />
        {errors.name && <p className="field-error">{errors.name}</p>}
      </div>
      <div className="field">
        <label htmlFor="su-email">Email</label>
        <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required disabled={busy} aria-invalid={errors.email ? true : undefined} />
        {errors.email && <p className="field-error">{errors.email}</p>}
      </div>
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" hint={password ? passwordHint(password) : 'At least 8 characters, with a letter and a number.'} error={errors.password} disabled={busy} />
      <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm} disabled={busy} />
      <div className="field consent">
        <label>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} aria-invalid={errors.consent ? true : undefined} />
          <span>
            I agree to the <Link to="/legal">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
          </span>
        </label>
        {errors.consent && <p className="field-error">{errors.consent}</p>}
      </div>
      <div aria-live="polite">{errors.form && <p className="form-status form-status--error">{errors.form}</p>}{failure && <ErrorNotice error={failure} />}</div>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
