import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MAX_MESSAGE_LENGTH, validateContact, type ContactErrors } from '../../shared/contact';
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } from '../../shared/subscribe';
import { failureInfo, networkError, type ErrorInfo } from '../lib/errors';
import ErrorNotice from './ErrorNotice';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'unconfigured' }
  | { kind: 'error'; error: ErrorInfo };

export default function ContactForm() {
  const uid = useId();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [errors, setErrors] = useState<ContactErrors>({});
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    message: useRef<HTMLTextAreaElement>(null),
    consent: useRef<HTMLInputElement>(null),
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === 'sending') return;
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      message: String(form.get('message') ?? ''),
      consent: form.get('consent') === 'on',
      website: String(form.get('website') ?? ''),
    };
    const result = validateContact(payload);
    if (!result.ok) {
      setErrors(result.errors);
      const first = (['name', 'email', 'message', 'consent'] as const).find((k) => result.errors[k]);
      if (first) refs[first].current?.focus();
      return;
    }
    setErrors({});
    setState({ kind: 'sending' });
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { status?: string; errors?: ContactErrors; message?: string } | null;
      if (!data) throw new Error('bad response');
      if (data.status === 'ok') return setState({ kind: 'sent' });
      if (data.status === 'unconfigured') return setState({ kind: 'unconfigured' });
      if (data.status === 'invalid' && data.errors) {
        setErrors(data.errors);
        return setState({ kind: 'idle' });
      }
      setState({ kind: 'error', error: failureInfo({ status: res.status, data }) });
    } catch {
      setState({ kind: 'error', error: networkError() });
    }
  }

  if (state.kind === 'sent') {
    return (
      <p className="form-status form-status--ok" role="status">
        Thank you. Your message has been received. We will reply by email.
      </p>
    );
  }

  const busy = state.kind === 'sending';
  const err = (k: keyof ContactErrors) => (errors[k] ? `${uid}-${k}-err` : undefined);
  return (
    <form className="signup" onSubmit={onSubmit} noValidate aria-label="Contact form">
      <div className="field">
        <label htmlFor={`${uid}-name`}>Name</label>
        <input ref={refs.name} id={`${uid}-name`} name="name" type="text" autoComplete="name" required maxLength={MAX_NAME_LENGTH} aria-invalid={Boolean(errors.name)} aria-describedby={err('name')} />
        {errors.name && <p className="field-error" id={`${uid}-name-err`}>{errors.name}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-email`}>Email address</label>
        <input ref={refs.email} id={`${uid}-email`} name="email" type="email" inputMode="email" autoComplete="email" required maxLength={MAX_EMAIL_LENGTH} aria-invalid={Boolean(errors.email)} aria-describedby={err('email')} />
        {errors.email && <p className="field-error" id={`${uid}-email-err`}>{errors.email}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-message`}>Message</label>
        <textarea ref={refs.message} id={`${uid}-message`} name="message" rows={6} required maxLength={MAX_MESSAGE_LENGTH} aria-invalid={Boolean(errors.message)} aria-describedby={err('message')} />
        {errors.message && <p className="field-error" id={`${uid}-message-err`}>{errors.message}</p>}
        <p className="field-hint">Please do not include health information. We cannot give medical advice.</p>
      </div>
      <div className="hp" aria-hidden="true">
        <label>
          Leave this field empty
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="field">
        <label className="consent">
          <input ref={refs.consent} type="checkbox" name="consent" aria-invalid={Boolean(errors.consent)} aria-describedby={err('consent')} />
          <span>
            I agree that Kaayra Herbals may store my name and email address to reply to this message. See the{' '}
            <Link to="/privacy">Privacy Policy</Link>.
          </span>
        </label>
        {errors.consent && <p className="field-error" id={`${uid}-consent-err`}>{errors.consent}</p>}
      </div>
      <div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send message'}
        </button>
      </div>
      <div aria-live="polite">
        {state.kind === 'error' && <ErrorNotice error={state.error} />}
        {state.kind === 'unconfigured' && (
          <p className="form-status form-status--info">The contact form is not open yet. Nothing has been sent.</p>
        )}
      </div>
    </form>
  );
}
