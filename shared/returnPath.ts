/**
 * Safe "return after sign-in" target. Only same-site, relative paths from a short allow-list are accepted, so a crafted link
 * (//evil.test, https://..., javascript:, backslashes, control characters) can never send a customer elsewhere.
 */
const ALLOWED = [/^\/track-order(\/[0-9a-f-]{36})?$/i, /^\/account$/, /^\/bag$/, /^\/checkout$/];

export function safeReturnPath(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 80) return null;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be rejected
  if (!v.startsWith('/') || v.startsWith('//') || /[\\\u0000-\u001f\s:?#]/.test(v)) return null;
  return ALLOWED.some((re) => re.test(v)) ? v : null;
}
