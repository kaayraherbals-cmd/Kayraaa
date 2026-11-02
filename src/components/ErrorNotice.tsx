import { Link } from 'react-router-dom';
import type { ErrorInfo } from '../lib/errors';

/** An error message with its code and reference, and a one-click way to report it. */
export default function ErrorNotice({ error, reportable = true }: { error: ErrorInfo; reportable?: boolean }) {
  const q = new URLSearchParams();
  if (error.code) q.set('code', error.code);
  if (error.ref) q.set('ref', error.ref);
  if (typeof window !== 'undefined') q.set('from', window.location.pathname);
  return (
    <div className="form-status form-status--error error-notice" role="alert">
      <p className="error-message">{error.message}</p>
      {error.code && (
        <p className="error-meta">
          <span>
            Error code <code>{error.code}</code>
          </span>
          {error.ref && (
            <span>
              Reference <code>{error.ref}</code>
            </span>
          )}
        </p>
      )}
      {reportable && (
        <p className="error-report">
          <Link to={`/report-a-problem?${q.toString()}`}>Report this problem</Link>
        </p>
      )}
    </div>
  );
}
