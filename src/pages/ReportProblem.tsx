import { useSearchParams } from 'react-router-dom';
import { ERROR_CODE_RE, ERRORS, isErrorCode, REF_RE } from '../../shared/errors';
import { cleanPage } from '../../shared/issues';
import ReportProblemForm from '../components/ReportProblemForm';
import { useNoIndex } from '../lib/auth';

export default function ReportProblem() {
  useNoIndex('Report a problem | Kaayra Herbals');
  const [params] = useSearchParams();
  const rawCode = params.get('code') ?? '';
  const code = ERROR_CODE_RE.test(rawCode) ? rawCode : '';
  const rawRef = params.get('ref') ?? '';
  const ref = REF_RE.test(rawRef) ? rawRef : '';
  const from = cleanPage(params.get('from'));
  const known = isErrorCode(code) ? ERRORS[code] : null;

  return (
    <section className="section">
      <div className="wrap">
        <div className="measure">
          <p className="eyebrow">Help us fix it</p>
          <h1>Report a problem</h1>
          <p className="lede">Tell us what went wrong and we will look into it. The more detail you give, the faster we can fix it.</p>
          {known && (
            <div className="notice" role="note">
              <strong>{known.message}</strong>
              <br />
              {known.fix}
            </div>
          )}
          <ReportProblemForm prefill={{ code, ref, from }} />
        </div>
      </div>
    </section>
  );
}
