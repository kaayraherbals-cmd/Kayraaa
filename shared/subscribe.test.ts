import { describe, expect, it } from 'vitest';
import { validateSubscribe } from './subscribe.js';

describe('validateSubscribe', () => {
  it('accepts a valid payload and normalises the email', () => {
    const r = validateSubscribe({ email: '  Asha@Example.COM ', name: ' Asha ', consent: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe('asha@example.com');
      expect(r.value.name).toBe('Asha');
    }
  });

  it('requires explicit consent', () => {
    const r = validateSubscribe({ email: 'a@b.co', consent: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.consent).toBeTruthy();
  });

  it('rejects malformed emails', () => {
    for (const email of ['', 'nope', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b..com']) {
      const r = validateSubscribe({ email, consent: true });
      expect(r.ok).toBe(false);
    }
  });

  it('rejects over-long names and non-object input', () => {
    expect(validateSubscribe({ email: 'a@b.co', consent: true, name: 'x'.repeat(81) }).ok).toBe(false);
    expect(validateSubscribe(null).ok).toBe(false);
  });
});
