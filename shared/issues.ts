import { ERROR_CODE_RE, REF_RE } from './errors.js';
import { MAX_EMAIL_LENGTH, normaliseEmail } from './subscribe.js';

export const ISSUE_CATEGORIES = [
  { value: 'broken', label: 'Something does not work' },
  { value: 'sign-in', label: 'Sign in or my account' },
  { value: 'display', label: 'Something looks wrong' },
  { value: 'content', label: 'Information is wrong or unclear' },
  { value: 'other', label: 'Something else' },
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]['value'];

export const ISSUE_STATUSES = ['open', 'investigating', 'resolved', 'closed'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = { open: 'Open', investigating: 'Investigating', resolved: 'Resolved', closed: 'Closed' };

export const SEVERITIES = ['low', 'normal', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const MIN_SUMMARY = 5;
export const MAX_SUMMARY = 120;
export const MIN_DETAILS = 10;
export const MAX_DETAILS = 2000;
export const MAX_NOTE = 2000;
export const MAX_PAGE = 200;

export interface IssuePayload {
  category: IssueCategory;
  summary: string;
  details: string;
  /** Optional. Only used to reply about this report. */
  email: string;
  consent: boolean;
  errorCode: string;
  ref: string;
  page: string;
  /** Honeypot: must stay empty. */
  website: string;
}

export type IssueErrors = Partial<Record<'category' | 'summary' | 'details' | 'email' | 'consent', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Keeps only a same-site path, without query or fragment, so a report never stores tokens from a URL. */
export function cleanPage(v: unknown): string {
  const raw = str(v);
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  return raw.split(/[?#]/)[0].slice(0, MAX_PAGE);
}

export function validateIssue(input: unknown): { ok: true; value: IssuePayload } | { ok: false; errors: IssueErrors } {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const errors: IssueErrors = {};

  const category = str(body.category);
  if (!ISSUE_CATEGORIES.some((c) => c.value === category)) errors.category = 'Choose what kind of problem this is.';

  const summary = str(body.summary);
  if (summary.length < MIN_SUMMARY) errors.summary = `Describe the problem in a few words (at least ${MIN_SUMMARY} characters).`;
  else if (summary.length > MAX_SUMMARY) errors.summary = `Keep the summary under ${MAX_SUMMARY} characters.`;

  const details = str(body.details);
  if (details.length < MIN_DETAILS) errors.details = `Tell us what happened (at least ${MIN_DETAILS} characters).`;
  else if (details.length > MAX_DETAILS) errors.details = `Keep the details under ${MAX_DETAILS} characters.`;

  const email = normaliseEmail(typeof body.email === 'string' ? body.email : '');
  if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email))) errors.email = 'Enter a valid email address, or leave it blank.';
  const consent = body.consent === true;
  if (email && !errors.email && !consent) errors.consent = 'Please confirm that we may store your email to reply about this report.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const code = str(body.errorCode);
  const ref = str(body.ref);
  return {
    ok: true,
    value: {
      category: category as IssueCategory,
      summary,
      details,
      email,
      consent,
      errorCode: ERROR_CODE_RE.test(code) ? code : '',
      ref: REF_RE.test(ref) ? ref : '',
      page: cleanPage(body.page),
      website: typeof body.website === 'string' ? body.website : '',
    },
  };
}

export interface IssueUpdate {
  status?: IssueStatus;
  severity?: Severity;
  admin_note?: string;
}

export function validateIssueUpdate(input: unknown): { ok: true; update: IssueUpdate } | { ok: false; message: string } {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const update: IssueUpdate = {};
  if ('status' in body) {
    if (!ISSUE_STATUSES.includes(body.status as IssueStatus)) return { ok: false, message: 'Invalid status.' };
    update.status = body.status as IssueStatus;
  }
  if ('severity' in body) {
    if (!SEVERITIES.includes(body.severity as Severity)) return { ok: false, message: 'Invalid severity.' };
    update.severity = body.severity as Severity;
  }
  if ('admin_note' in body) {
    if (typeof body.admin_note !== 'string' || body.admin_note.length > MAX_NOTE) return { ok: false, message: `Notes must be ${MAX_NOTE} characters or fewer.` };
    update.admin_note = body.admin_note.trim();
  }
  if (Object.keys(update).length === 0) return { ok: false, message: 'Nothing to update.' };
  return { ok: true, update };
}
