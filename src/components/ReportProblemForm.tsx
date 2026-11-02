import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ISSUE_CATEGORIES, MAX_DETAILS, MAX_SUMMARY, validateIssue, type IssueErrors } from '../../shared/issues';
import { MAX_EMAIL_LENGTH } from '../../shared/subscribe';
import { failureInfo, type ErrorInfo } from '../lib/errors';
import ErrorNotice from './ErrorNotice';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; reportRef: string } | { kind: 'error'; error: ErrorInfo };

interface Prefill {
  code: string;
  ref: string;
  from: string;
}

export default function ReportProblemForm({ prefill }: { prefill: Prefill }) {
  const uid = useId();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [errors, setErrors] = useState<IssueErrors>({});
  const [email, setEmail] = useState('');
  const refs = {
    category: useRef<HTMLSelectElement>(null),
    summary: useRef<HTMLInputElement>(null),
    details: useRef<HTMLTextAreaElement>(null),
    email: useRef<HTMLInputElement>(null),
    consent: useRef<HTMLInputElement>(null),
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === 'sending') return;
    const f = new FormData(e.currentTarget);
    const payload = {
      category: String(f.get('category') ?? ''),
      summary: String(f.get('summary') ?? ''),
      details: String(f.get('details') ?? ''),
      email: String(f.get('email') ?? ''),
      consent: f.get('consent') === 'on',
      website: String(f.get('website') ?? ''),
      errorCode: prefill.code,
      ref: prefill.ref,
      page: prefill.from,
    };
    const result = validateIssue(payload);
    if (!result.ok) {
      setErrors(result.errors);
      const first = (['category', 'summary', 'details', 'email', 'consent'] as const).find((k) => result.errors[k]);
      if (first) refs[first].current?.focus();
      return;
    }
    setErrors({});
    setState({ kind: 'sending' });
    try {
      const res = await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = (await res.json().catch(() => null)) as { status?: string; reportRef?: string; errors?: IssueErrors; message?: string } | null;
      if (data?.status === 'ok' && data.reportRef) return setState({ kind: 'sent', reportRef: data.reportRef });
      if (data?.errors) {
        setErrors(data.errors);
        return setState({ kind: 'idle' });
      }
      setState({ kind: 'error', error: failureInfo({ status: res.status, data }) });
    } catch {
      setState({ kind: 'error', error: failureInfo({ status: 0, data: null }) });
    }
  }

  if (state.kind === 'sent') {
    return (
      <div className="form-status form-status--ok report-done" role="status">
        <p>
          <strong>Thank you. Your report has been received.</strong>
        </p>
        <p>
          Your report number is <code>{state.reportRef}</code>. Quote it if you write to us about this.
        </p>
        <p>
          <Link to="/">Back to the home page</Link>
        </p>
      </div>
    );
  }

  const busy = state.kind === 'sending';
  const err = (k: keyof IssueErrors) => (errors[k] ? `${uid}-${k}-err` : undefined);
  return (
    <form className="signup" onSubmit={onSubmit} noValidate aria-label="Report a problem">
      {(prefill.code || prefill.ref || prefill.from) && (
        <dl className="report-context" aria-label="Details included with your report">
          {prefill.code && (
            <div>
              <dt>Error code</dt>
              <dd>
                <code>{prefill.code}</code>
              </dd>
            </div>
          )}
          {prefill.ref && (
            <div>
              <dt>Reference</dt>
              <dd>
                <code>{prefill.ref}</code>
              </dd>
            </div>
          )}
          {prefill.from && (
            <div>
              <dt>Page</dt>
              <dd>
                <code>{prefill.from}</code>
              </dd>
            </div>
          )}
        </dl>
      )}
      <div className="field">
        <label htmlFor={`${uid}-category`}>What kind of problem is it?</label>
        <select ref={refs.category} id={`${uid}-category`} name="category" defaultValue="" required aria-invalid={Boolean(errors.category)} aria-describedby={err('category')}>
          <option value="" disabled>
            Choose one
          </option>
          {ISSUE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {errors.category && <p className="field-error" id={`${uid}-category-err`}>{errors.category}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-summary`}>Summary</label>
        <input ref={refs.summary} id={`${uid}-summary`} name="summary" type="text" maxLength={MAX_SUMMARY} required aria-invalid={Boolean(errors.summary)} aria-describedby={err('summary')} />
        {errors.summary && <p className="field-error" id={`${uid}-summary-err`}>{errors.summary}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-details`}>What happened?</label>
        <textarea ref={refs.details} id={`${uid}-details`} name="details" rows={6} maxLength={MAX_DETAILS} required aria-invalid={Boolean(errors.details)} aria-describedby={err('details')} />
        {errors.details && <p className="field-error" id={`${uid}-details-err`}>{errors.details}</p>}
        <p className="field-hint">What you did, what you expected, and what you saw instead. Please do not include passwords or health information.</p>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-email`}>Email address (optional)</label>
        <input ref={refs.email} id={`${uid}-email`} name="email" type="email" inputMode="email" autoComplete="email" maxLength={MAX_EMAIL_LENGTH} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={err('email')} />
        {errors.email && <p className="field-error" id={`${uid}-email-err`}>{errors.email}</p>}
        <p className="field-hint">Only if you would like a reply.</p>
      </div>
      <div className="hp" aria-hidden="true">
        <label>
          Leave this field empty
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {email.trim() && (
        <div className="field">
          <label className="consent">
            <input ref={refs.consent} type="checkbox" name="consent" aria-invalid={Boolean(errors.consent)} aria-describedby={err('consent')} />
            <span>
              I agree that Kaayra Herbals may store my email address to reply about this report. See the <Link to="/privacy">Privacy Policy</Link>.
            </span>
          </label>
          {errors.consent && <p className="field-error" id={`${uid}-consent-err`}>{errors.consent}</p>}
        </div>
      )}
      <p className="field-hint">We save your report, the page you were on and your browser type, so we can find and fix the problem.</p>
      <div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </div>
      <div aria-live="polite">{state.kind === 'error' && <ErrorNotice error={state.error} reportable={false} />}</div>
    </form>
  );
}
