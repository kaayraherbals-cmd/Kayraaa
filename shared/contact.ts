import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, normaliseEmail } from './subscribe.js';

export const MIN_MESSAGE_LENGTH = 10;
export const MAX_MESSAGE_LENGTH = 2000;

export interface ContactPayload {
  name: string;
  email: string;
  message: string;
  consent: true;
  /** Honeypot: must stay empty. */
  website?: string;
}

export type ContactErrors = Partial<Record<'name' | 'email' | 'message' | 'consent', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validateContact(
  input: unknown,
): { ok: true; value: ContactPayload } | { ok: false; errors: ContactErrors } {
  const errors: ContactErrors = {};
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) errors.name = 'Enter your name.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;

  const email = normaliseEmail(typeof body.email === 'string' ? body.email : '');
  if (!email) errors.email = 'Enter your email address.';
  else if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < MIN_MESSAGE_LENGTH) errors.message = `Write at least ${MIN_MESSAGE_LENGTH} characters.`;
  else if (message.length > MAX_MESSAGE_LENGTH) errors.message = `Keep your message under ${MAX_MESSAGE_LENGTH} characters.`;

  if (body.consent !== true) errors.consent = 'Please confirm that we may store your details to reply.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, email, message, consent: true, website: typeof body.website === 'string' ? body.website : '' },
  };
}
