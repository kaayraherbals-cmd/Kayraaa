/**
 * Kaayra error code system.
 *
 * Every error a visitor can see carries a code like KH-AUTH-001 (stable, listed in docs/ERROR_CODES.md) and, when it
 * came from the server, a one-off reference like R-7K2M9QXA. The code says WHAT went wrong; the reference finds THAT
 * occurrence in the Vercel logs. Both are pre-filled into the "Report a problem" form.
 *
 * Keep one entry per line: docs/ERROR_CODES.md is generated from this file.
 */
export type ErrorArea = 'AUTH' | 'FORM' | 'ADMIN' | 'ISSUE' | 'CART' | 'CHECKOUT' | 'PAY' | 'NET' | 'SYS';

export interface ErrorDef {
  status: number;
  /** What the visitor sees. Plain language, no blame, no jargon. */
  message: string;
  /** What to try next. */
  fix: string;
}

export const ERRORS = {
  'KH-AUTH-001': { status: 401, message: 'That email and password do not match.', fix: 'Check both and try again, or reset your password.' },
  'KH-AUTH-002': { status: 403, message: 'Please verify your email first.', fix: 'Open the verification link we emailed you. Check spam if it is missing.' },
  'KH-AUTH-003': { status: 429, message: 'Too many attempts. Please wait a few minutes and try again.', fix: 'Wait 15 minutes, then try again.' },
  'KH-AUTH-004': { status: 403, message: 'We are not accepting new accounts right now.', fix: 'Join the launch list and we will tell you when accounts open.' },
  'KH-AUTH-005': { status: 401, message: 'Your session has ended. Please sign in again.', fix: 'Sign in again.' },
  'KH-AUTH-006': { status: 400, message: 'That password cannot be used.', fix: 'Use at least 8 characters with a letter and a number, and avoid common passwords.' },
  'KH-AUTH-007': { status: 400, message: 'Sign-in was cancelled. Nothing was changed.', fix: 'Start again when you are ready.' },
  'KH-AUTH-008': { status: 400, message: 'That link or sign-in attempt expired.', fix: 'Start again to get a fresh link.' },
  'KH-AUTH-009': { status: 400, message: 'We could not confirm a verified email address.', fix: 'Use an account with a verified email, or sign up with email and password.' },
  'KH-AUTH-010': { status: 503, message: 'Sign-in is not set up yet.', fix: 'Owner: check the Supabase and session variables in docs/VERCEL_SETUP.md.' },
  'KH-AUTH-011': { status: 502, message: 'Sign-in is busy right now. Please try again shortly.', fix: 'Wait a minute and retry. If it keeps happening, report it.' },
  'KH-AUTH-012': { status: 403, message: 'This action is not allowed for this account.', fix: 'Contact us if you think this is a mistake.' },
  'KH-AUTH-013': { status: 400, message: 'Your email is verified. Please sign in with your email and password.', fix: 'Sign in below. The verification link only signs you in on the browser where you started.' },
  'KH-AUTH-014': { status: 400, message: 'That sign-in method is not available.', fix: 'Choose another method, or use email and password.' },
  'KH-AUTH-015': { status: 403, message: 'That account does not have administrator access.', fix: 'Sign in with an administrator account.' },
  'KH-FORM-001': { status: 400, message: 'Some details need fixing.', fix: 'Check the highlighted fields and send again.' },
  'KH-FORM-002': { status: 503, message: 'This form is not open yet. Nothing has been sent.', fix: 'Try again later.' },
  'KH-FORM-003': { status: 502, message: 'We could not save that. Please try again.', fix: 'Try again in a minute. If it keeps happening, report it.' },
  'KH-FORM-004': { status: 429, message: 'Too many attempts. Please try again later.', fix: 'Wait about ten minutes.' },
  'KH-ADMIN-001': { status: 503, message: 'Admin access is not configured on the server.', fix: 'Owner: set the admin variables in docs/VERCEL_SETUP.md and redeploy.' },
  'KH-ADMIN-002': { status: 401, message: 'Incorrect email or password, or this account has no admin access.', fix: 'Check your details, or ask the owner to add your email to ADMIN_EMAILS.' },
  'KH-ADMIN-003': { status: 401, message: 'Your admin session has ended. Sign in to continue.', fix: 'Sign in again.' },
  'KH-ADMIN-004': { status: 502, message: 'The database request failed. Try again.', fix: 'Retry. If it persists, search the Vercel logs for the reference.' },
  'KH-ADMIN-005': { status: 409, message: 'This change is not allowed yet.', fix: 'Complete the checklist shown with the message.' },
  'KH-ADMIN-006': { status: 429, message: 'Too many attempts. Try again in 15 minutes.', fix: 'Wait 15 minutes.' },
  'KH-ADMIN-007': { status: 403, message: 'Your role does not have permission for this action.', fix: 'Ask an owner to do it, or to change your role (ADMIN_ROLES).' },
  'KH-ADMIN-008': { status: 401, message: 'Two-step verification is needed before you can continue.', fix: 'Enter the code from your authenticator app, or set it up if you have not yet.' },
  'KH-ADMIN-009': { status: 409, message: 'That change conflicts with the current stock or order state.', fix: 'Reload the page to see the latest figures, then try again.' },
  'KH-ADMIN-010': { status: 409, message: 'Selling is not enabled, so orders cannot be created yet.', fix: 'Owner: see docs/ECOMMERCE_ARCHITECTURE.md before changing COMMERCE_ENABLED.' },
  'KH-ADMIN-011': { status: 401, message: 'That verification code is not correct or has expired.', fix: 'Wait for the next code and try again, or use a recovery code.' },
  'KH-ADMIN-012': { status: 503, message: 'Two-step verification is not set up on the server.', fix: 'Owner: set ADMIN_MFA_KEY and run supabase/roles_mfa_audit.sql, or set ADMIN_MFA=optional meanwhile.' },
  'KH-ADMIN-013': { status: 503, message: 'Online payments are not set up on the server.', fix: 'Owner: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel (see docs/RAZORPAY_SETUP.md) and redeploy.' },
  'KH-ISSUE-001': { status: 400, message: 'Your report needs a little more detail.', fix: 'Check the highlighted fields and send again.' },
  'KH-ISSUE-002': { status: 429, message: 'You have sent several reports. Please try again later.', fix: 'Wait about ten minutes.' },
  'KH-ISSUE-003': { status: 503, message: 'Problem reports are not open yet. Nothing has been sent.', fix: 'Email us instead, or try again later.' },
  'KH-ISSUE-004': { status: 502, message: 'We could not save your report. Please try again.', fix: 'Try again in a minute.' },
  'KH-CART-001': { status: 404, message: 'The shopping bag is not open yet.', fix: 'Nothing is for sale yet. Join the launch list and we will tell you first.' },
  'KH-CART-002': { status: 401, message: 'Please sign in to keep a saved bag.', fix: 'Sign in, then try again. Your bag on this device is kept.' },
  'KH-CART-003': { status: 400, message: 'Some items in your bag need fixing.', fix: 'Check the items shown and try again.' },
  'KH-CART-004': { status: 409, message: 'Your bag is full.', fix: 'Remove an item before adding another.' },
  'KH-CART-005': { status: 429, message: 'Too many requests. Please try again in a moment.', fix: 'Wait a minute, then try again.' },
  'KH-CART-007': { status: 422, message: 'That coupon could not be applied.', fix: 'Read the reason shown, or remove the coupon and continue without it.' },
  'KH-CART-006': { status: 502, message: 'We could not update your bag. Please try again.', fix: 'Try again in a minute. If it keeps happening, report it.' },
  'KH-CHK-001': { status: 404, message: 'Checkout is not open yet.', fix: 'Nothing is for sale yet. Join the launch list and we will tell you first.' },
  'KH-CHK-002': { status: 401, message: 'Please sign in to check out.', fix: 'Sign in, then return to your bag. Your bag is kept.' },
  'KH-CHK-003': { status: 400, message: 'Some delivery details need fixing.', fix: 'Check the highlighted fields and try again.' },
  'KH-CHK-004': { status: 409, message: 'Something in your bag changed.', fix: 'Review your bag and the updated total, then continue.' },
  'KH-CHK-005': { status: 422, message: 'We cannot deliver to that PIN code yet.', fix: 'Try a different delivery address, or join the launch list for updates.' },
  'KH-CHK-006': { status: 429, message: 'Too many attempts. Please wait a moment.', fix: 'Wait a minute, then try again.' },
  'KH-CHK-007': { status: 502, message: 'We could not place your order. Nothing was charged.', fix: 'Try again in a minute. If it keeps happening, report it with this code.' },
  'KH-CHK-009': { status: 503, message: 'Checkout is briefly unavailable. Nothing was charged.', fix: 'Try again in a few minutes.' },
  'KH-CHK-008': { status: 409, message: 'This order was already submitted differently.', fix: 'Reload checkout and try again.' },
  'KH-PAY-001': { status: 404, message: 'Online payment is not open yet.', fix: 'Nothing is for sale yet, so no payment can be made.' },
  'KH-PAY-002': { status: 401, message: 'Please sign in to pay for your order.', fix: 'Sign in, then return to your order.' },
  'KH-PAY-003': { status: 400, message: 'That payment request was not valid.', fix: 'Go back to your order and try again.' },
  'KH-PAY-004': { status: 400, message: 'We could not confirm that payment.', fix: 'If money left your account, do not pay again. Keep this code and report it; we will check with Razorpay.' },
  'KH-PAY-005': { status: 409, message: 'This order can no longer be paid.', fix: 'The payment window ended or the order was cancelled. Place the order again from your bag.' },
  'KH-PAY-009': { status: 503, message: 'Payments are briefly unavailable. Nothing was charged.', fix: 'Try again in a few minutes.' },
  'KH-PAY-006': { status: 429, message: 'Too many attempts. Please wait a moment.', fix: 'Wait a minute, then try again.' },
  'KH-PAY-007': { status: 502, message: 'We could not start the payment. Nothing was charged.', fix: 'Try again in a minute. If it keeps happening, report it with this code.' },
  'KH-PAY-008': { status: 503, message: 'Online payment is not set up on the server.', fix: 'Owner: set the Razorpay variables in Vercel (docs/RAZORPAY_SETUP.md) and redeploy.' },
  'KH-NET-001': { status: 0, message: 'We could not reach the server. Check your connection and try again.', fix: 'Check your internet connection, then retry.' },
  'KH-SYS-001': { status: 500, message: 'Something went wrong on our side. Please try again.', fix: 'Retry. If it keeps happening, report it with this code.' },
  'KH-SYS-002': { status: 405, message: 'That request is not supported.', fix: 'Reload the page and try again.' },
  'KH-SYS-003': { status: 404, message: 'We could not find that.', fix: 'Check the address, or go back to the home page.' },
  'KH-SYS-004': { status: 403, message: 'That request was not allowed.', fix: 'Reload the page and try again.' },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ERRORS;

export const ERROR_CODE_RE = /^KH-[A-Z]{2,5}-\d{3}$/;
export const REF_RE = /^R-[A-HJ-NP-Z2-9]{8}$/;
export const ISSUE_REF_RE = /^IS-[A-HJ-NP-Z2-9]{6}$/;

// 32 characters with no 0/O/1/I, so a reference read aloud or copied by hand is hard to get wrong.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** One-off reference for a single error occurrence, e.g. R-7K2M9QXA. */
export const makeRef = (): string => `R-${randomChars(8)}`;
/** Public number for a submitted problem report, e.g. IS-4F7K2Q. */
export const makeIssueRef = (): string => `IS-${randomChars(6)}`;

export const isErrorCode = (v: unknown): v is ErrorCode => typeof v === 'string' && Object.hasOwn(ERRORS, v);

export function messageFor(code: ErrorCode): string {
  return ERRORS[code].message;
}

interface BodyHint {
  code?: unknown;
  field?: unknown;
  status?: unknown;
  message?: unknown;
}

function generic(status: number): ErrorCode {
  if (status === 405) return 'KH-SYS-002';
  if (status === 404) return 'KH-SYS-003';
  if (status === 403) return 'KH-SYS-004';
  return 'KH-SYS-001';
}

/** Picks the catalogue code for an error response, from where it came from, its HTTP status and what the body says. */
export function deriveErrorCode(area: Exclude<ErrorArea, 'NET' | 'SYS'>, status: number, body: BodyHint = {}): ErrorCode {
  const msg = typeof body.message === 'string' ? body.message : '';
  if (area === 'AUTH') {
    if (body.code === 'unverified') return 'KH-AUTH-002';
    if (body.field === 'password') return 'KH-AUTH-006';
    if (body.field === 'name' || body.field === 'email' || body.field === 'consent') return 'KH-FORM-001';
    if (status === 429) return 'KH-AUTH-003';
    if (status === 401) return /do not match/i.test(msg) ? 'KH-AUTH-001' : 'KH-AUTH-005';
    if (status === 403) return /not accepting/i.test(msg) ? 'KH-AUTH-004' : /administrator/i.test(msg) ? 'KH-AUTH-012' : 'KH-SYS-004';
    if (status === 400) return 'KH-FORM-001';
    if (status === 502) return 'KH-AUTH-011';
    if (status === 503) return 'KH-AUTH-010';
    return generic(status);
  }
  if (area === 'ADMIN') {
    if (status === 503) return body.status === 'mfa_unavailable' ? 'KH-ADMIN-012' : body.status === 'payments_unavailable' ? 'KH-ADMIN-013' : 'KH-ADMIN-001';
    if (status === 429) return 'KH-ADMIN-006';
    if (status === 409) return body.status === 'conflict' ? 'KH-ADMIN-009' : body.status === 'commerce_off' ? 'KH-ADMIN-010' : 'KH-ADMIN-005';
    if (status === 403 && body.status === 'forbidden') return 'KH-ADMIN-007';
    if (status === 502) return 'KH-ADMIN-004';
    if (status === 401) return body.status === 'denied' ? 'KH-ADMIN-002' : body.status === 'mfa_required' ? 'KH-ADMIN-008' : body.status === 'mfa_denied' ? 'KH-ADMIN-011' : 'KH-ADMIN-003';
    if (status === 400) return 'KH-FORM-001';
    return generic(status);
  }
  if (area === 'CART') {
    if (status === 404) return 'KH-CART-001';
    if (status === 401) return 'KH-CART-002';
    if (status === 400) return 'KH-CART-003';
    if (status === 409) return 'KH-CART-004';
    if (status === 429) return 'KH-CART-005';
    if (status === 502) return 'KH-CART-006';
    return generic(status);
  }
  if (area === 'CHECKOUT') {
    if (status === 404) return 'KH-CHK-001';
    if (status === 401) return 'KH-CHK-002';
    if (status === 400) return 'KH-CHK-003';
    if (status === 409) return 'KH-CHK-004';
    if (status === 422) return 'KH-CHK-005';
    if (status === 429) return 'KH-CHK-006';
    if (status === 502) return 'KH-CHK-007';
    return generic(status);
  }
  if (area === 'PAY') {
    if (status === 404) return 'KH-PAY-001';
    if (status === 401) return 'KH-PAY-002';
    if (status === 400) return 'KH-PAY-003';
    if (status === 409) return 'KH-PAY-005';
    if (status === 429) return 'KH-PAY-006';
    if (status === 502) return 'KH-PAY-007';
    if (status === 503) return 'KH-PAY-008';
    return generic(status);
  }
  if (area === 'ISSUE') {
    if (status === 400) return 'KH-ISSUE-001';
    if (status === 429) return 'KH-ISSUE-002';
    if (status === 503) return 'KH-ISSUE-003';
    if (status === 502) return 'KH-ISSUE-004';
    return generic(status);
  }
  // FORM: contact and launch-list sign-up
  if (status === 400) return 'KH-FORM-001';
  if (status === 429) return 'KH-FORM-004';
  if (status === 503) return 'KH-FORM-002';
  if (status === 502) return 'KH-FORM-003';
  return generic(status);
}
