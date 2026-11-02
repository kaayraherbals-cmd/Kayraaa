import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, validateSubscribe, type FieldErrors } from '../../shared/subscribe';

type State =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'ok' }
  | { kind: 'duplicate' }
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string };

/** Signed-in customers: no email or name to type. One tick and one button; the email we hold for the account is used. */
function MemberJoin({ email }: { email: string }) {
  const uid = useId();
  const [state, setState] = useState<'idle' | 'busy' | 'joined' | 'already' | 'unconfigured' | 'error'>('idle');
  const [consentError, setConsentError] = useState(false);
  const [message, setMessage] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'busy') return;
    const consent = new FormData(e.currentTarget).get('consent') === 'on';
    if (!consent) return setConsentError(true);
    setConsentError(false);
    setState('busy');
    try {
      const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'join_member', consent: true }) });
      const data = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
      if (data?.status === 'joined') return setState('joined');
      if (data?.status === 'already_joined') return setState('already');
      if (data?.status === 'unconfigured') return setState('unconfigured');
      setMessage(data?.message ?? 'Something went wrong. Please try again.');
      setState('error');
    } catch {
      setMessage('We could not reach the server. Please check your connection and try again.');
      setState('error');
    }
  }

  if (state === 'joined' || state === 'already') {
    return (
      <p className="form-status form-status--ok" role="status">
        {state === 'joined' ? `You have joined the launch list. We have sent a confirmation to ${email}.` : 'You are already on the launch list.'}
      </p>
    );
  }
  return (
    <form className="signup" onSubmit={onSubmit} noValidate aria-label="Join the launch list">
      <div className="field">
        <label className="consent">
          <input type="checkbox" name="consent" aria-invalid={consentError} aria-describedby={consentError ? `${uid}-err` : undefined} />
          <span>
            I agree that Kaayra Herbals may use my account email ({email}) to contact me about its launch. I can withdraw at any time with the unsubscribe link in every email. See the <Link to="/privacy">Privacy Policy</Link>.
          </span>
        </label>
        {consentError && <p className="field-error" id={`${uid}-err`}>Please confirm that you agree to receive launch updates.</p>}
      </div>
      <div>
        <button className="btn" type="submit" disabled={state === 'busy'}>{state === 'busy' ? 'Joining…' : 'Join the launch list'}</button>
      </div>
      <div aria-live="polite">
        {state === 'error' && <p className="form-status form-status--error">{message}</p>}
        {state === 'unconfigured' && <p className="form-status form-status--info">Launch notifications are not open yet. Please check back soon. Nothing has been saved.</p>}
      </div>
    </form>
  );
}

export default function SignupForm() {
  const { user } = useSession();
  return user ? <MemberJoin email={user.email} /> : <GuestSignup />;
}

function GuestSignup() {
  const uid = useId();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === 'submitting') return;
    const form = new FormData(e.currentTarget);
    const payload = {
      email: String(form.get('email') ?? ''),
      name: String(form.get('name') ?? ''),
      consent: form.get('consent') === 'on',
      website: String(form.get('website') ?? ''),
    };

    const result = validateSubscribe(payload);
    if (!result.ok) {
      setErrors(result.errors);
      (result.errors.email ? emailRef : consentRef).current?.focus();
      return;
    }
    setErrors({});
    setState({ kind: 'submitting' });

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { status?: string; errors?: FieldErrors; message?: string } | null;
      if (!data) throw new Error('bad response');
      if (data.status === 'ok') return setState({ kind: 'ok' });
      if (data.status === 'duplicate') return setState({ kind: 'duplicate' });
      if (data.status === 'unconfigured') return setState({ kind: 'unconfigured' });
      if (data.status === 'invalid' && data.errors) {
        setErrors(data.errors);
        return setState({ kind: 'idle' });
      }
      setState({ kind: 'error', message: data.message ?? 'Something went wrong. Please try again.' });
    } catch {
      setState({ kind: 'error', message: 'We could not reach the server. Please check your connection and try again.' });
    }
  }

  if (state.kind === 'ok' || state.kind === 'duplicate') {
    return (
      <p className="form-status form-status--ok" role="status">
        {state.kind === 'ok'
          ? 'Almost done. If that address can receive mail, we have sent you an email with a link to confirm it. You will not be added to the launch list until you confirm. Please check your spam folder too.'
          : 'Please check your inbox for our confirmation email.'}
      </p>
    );
  }

  const busy = state.kind === 'submitting';
  return (
    <form className="signup" onSubmit={onSubmit} noValidate aria-label="Launch notification sign-up">
      <div className="field">
        <label htmlFor={`${uid}-name`}>Name (optional)</label>
        <input id={`${uid}-name`} name="name" type="text" autoComplete="given-name" maxLength={MAX_NAME_LENGTH} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${uid}-name-err` : undefined} />
        {errors.name && <p className="field-error" id={`${uid}-name-err`}>{errors.name}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-email`}>Email address</label>
        <input ref={emailRef} id={`${uid}-email`} name="email" type="email" inputMode="email" autoComplete="email" required maxLength={MAX_EMAIL_LENGTH} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? `${uid}-email-err` : undefined} />
        {errors.email && <p className="field-error" id={`${uid}-email-err`}>{errors.email}</p>}
      </div>
      <div className="hp" aria-hidden="true">
        <label>
          Leave this field empty
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="field">
        <label className="consent">
          <input ref={consentRef} type="checkbox" name="consent" aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? `${uid}-consent-err` : undefined} />
          <span>
            I agree that Kaayra Herbals may store my email address, send me one email to confirm it, and then contact me about its launch. I can withdraw at any time with the unsubscribe link in every email. See the{' '}
            <Link to="/privacy">Privacy Policy</Link>.
          </span>
        </label>
        {errors.consent && <p className="field-error" id={`${uid}-consent-err`}>{errors.consent}</p>}
      </div>
      <div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send me a confirmation email'}
        </button>
      </div>
      <div aria-live="polite">
        {state.kind === 'error' && <p className="form-status form-status--error">{state.message}</p>}
        {state.kind === 'unconfigured' && (
          <p className="form-status form-status--info">
            Launch notifications are not open yet. Please check back soon. Nothing has been saved.
          </p>
        )}
      </div>
    </form>
  );
}
