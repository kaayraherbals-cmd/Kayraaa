import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import PasswordField, { passwordHint } from '../components/PasswordField';
import { authApi, useNoIndex } from '../lib/auth';

interface Pending {
  email: string;
  name: string | null;
  mode: 'setup' | 'reset';
}

/** Shown after a first Google sign-in (name + password + confirm) and after a reset link (new password + confirm). */
export default function SetPassword() {
  useNoIndex('Choose a password | Kaayra Herbals');
  const [pending, setPending] = useState<Pending | null | 'none'>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'password' | 'confirm' | 'form', string>>>({});

  useEffect(() => {
    let live = true;
    void authApi<Pending>('pending').then((r) => {
      if (!live) return;
      if (r.ok && r.data) {
        setPending(r.data);
        setName(r.data.name ?? '');
      } else setPending('none');
    });
    return () => {
      live = false;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setErrors({ confirm: 'The two passwords do not match.' });
    setErrors({});
    setBusy(true);
    const r = await authApi<{ redirect?: string }>('set-password', 'POST', { name, password, confirm });
    if (r.ok) {
      window.location.assign(r.data?.redirect ?? '/account');
      return;
    }
    setBusy(false);
    const msg = r.data?.message ?? 'We could not reach the server. Please try again.';
    const f = r.data?.field;
    setErrors(f === 'name' || f === 'password' ? { [f]: msg } : { form: msg });
  }

  const reset = pending && pending !== 'none' && pending.mode === 'reset';

  return (
    <AuthShell>
      <div className="auth-card auth-surface" aria-busy={pending === null}>
        {pending === null && (
          <div role="status" aria-label="Loading" className="account-skel">
            <span className="skel skel--line" />
            <span className="skel skel--line skel--short" />
          </div>
        )}
        {pending === 'none' && (
          <div className="auth-form" data-auth="1">
            <h1>This step has expired</h1>
            <p className="muted">For your security this page only works for a short time after signing in or opening a reset link.</p>
            <Link className="btn" to="/login">
              Back to sign in
            </Link>
          </div>
        )}
        {pending && pending !== 'none' && (
          <>
            <div data-auth="1">
              <h1>{reset ? 'Choose a new password' : 'One last step'}</h1>
              <p className="muted">
                {reset
                  ? `Set a new password for ${pending.email}.`
                  : `You are signed in as ${pending.email}. Tell us your name and choose a password. You will use it to sign in with your email later, alongside Google.`}
              </p>
            </div>
            <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy} data-auth="2">
              {!reset && (
                <div className="field">
                  <label htmlFor="sp-name">Your name</label>
                  <input id="sp-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" minLength={2} maxLength={100} required disabled={busy} aria-invalid={errors.name ? true : undefined} />
                  {errors.name && <p className="field-error">{errors.name}</p>}
                </div>
              )}
              <PasswordField label={reset ? 'New password' : 'Password'} value={password} onChange={setPassword} autoComplete="new-password" hint={password ? passwordHint(password) : 'At least 8 characters, with a letter and a number.'} error={errors.password} disabled={busy} />
              <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm} disabled={busy} />
              <div aria-live="polite">{errors.form && <p className="form-status form-status--error">{errors.form}</p>}</div>
              <button type="submit" className="btn" disabled={busy}>
                {busy ? 'Saving…' : reset ? 'Save password and sign in' : 'Save and continue'}
              </button>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  );
}
