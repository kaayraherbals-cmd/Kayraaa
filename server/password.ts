/** Input rules for names, emails and passwords. Pure functions so they can be unit-tested. */

export const PASSWORD_MIN = 8;
// Supabase hashes with bcrypt, which only uses the first 72 bytes.
export const PASSWORD_MAX_BYTES = 72;

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', 'qwerty123', 'iloveyou', 'kaayra123', 'kaayraherbals']);

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return v.length >= 2 && v.length <= 100 ? v : null;
}

export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 254 || !/^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]{2,}$/.test(v)) return null;
  return v;
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: unknown, confirm: unknown, email?: string): string | null {
  if (typeof password !== 'string' || typeof confirm !== 'string') return 'Please enter a password and confirm it.';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return 'That password is too long. Use 72 bytes or fewer.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Include at least one letter and one number.';
  if (COMMON.has(password.toLowerCase())) return 'That password is too common. Please choose another.';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Your password cannot be your email address.';
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}
