// v2: the wording now describes the confirmation email (double opt-in) and the unsubscribe link.
export const CONSENT_VERSION = '2026-10-v2';
export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 80;

export interface SubscribePayload {
  email: string;
  name?: string;
  consent: boolean;
  /** Honeypot: must stay empty. */
  website?: string;
}

export type FieldErrors = Partial<Record<'email' | 'name' | 'consent', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateSubscribe(input: unknown): { ok: true; value: SubscribePayload } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  const emailRaw = typeof body.email === 'string' ? body.email : '';
  const email = normaliseEmail(emailRaw);
  if (!email) errors.email = 'Enter your email address.';
  else if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';

  const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
  if (nameRaw.length > MAX_NAME_LENGTH) errors.name = `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;

  if (body.consent !== true) errors.consent = 'Please confirm that you agree to receive launch updates.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      email,
      name: nameRaw || undefined,
      consent: true,
      website: typeof body.website === 'string' ? body.website : '',
    },
  };
}
