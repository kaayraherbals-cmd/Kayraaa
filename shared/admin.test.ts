import { describe, expect, it } from 'vitest';
import { csvCell, parsePage, sanitiseSearch, toCsv, UUID_RE } from './admin.js';
import { validateContact } from './contact.js';

describe('admin helpers', () => {
  it('sanitises search input for PostgREST filters', () => {
    // Structural characters are stripped, so input can never add or alter filter clauses.
    expect(sanitiseSearch('asha),email.eq.x*')).toBe('ashaemail.eq.x');
    expect(/[,()*%\\]/.test(sanitiseSearch('a,b(c)d*e%f\\g'))).toBe(false);
    expect(sanitiseSearch('a@b.co')).toBe('a@b.co');
    expect(sanitiseSearch(42)).toBe('');
  });

  it('neutralises CSV formula injection and escapes quotes', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell(null)).toBe('""');
  });

  it('builds CSV with a header row', () => {
    expect(toCsv(['a', 'b'], [{ a: 1, b: 'x' }])).toBe('"a","b"\r\n"1","x"\r\n');
  });

  it('validates UUIDs and page numbers', () => {
    expect(UUID_RE.test('3f2b8a3e-7a1c-4a52-9a6f-0c1d2e3f4a5b')).toBe(true);
    expect(UUID_RE.test('1 or 1=1')).toBe(false);
    expect(parsePage('3')).toBe(3);
    expect(parsePage('-2')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});

describe('validateContact', () => {
  const good = { name: 'Asha', email: 'Asha@Example.com', message: 'Hello, I have a question.', consent: true };
  it('accepts a valid enquiry', () => {
    const r = validateContact(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe('asha@example.com');
  });
  it('rejects missing consent, short messages and bad emails', () => {
    expect(validateContact({ ...good, consent: false }).ok).toBe(false);
    expect(validateContact({ ...good, message: 'hi' }).ok).toBe(false);
    expect(validateContact({ ...good, email: 'nope' }).ok).toBe(false);
    expect(validateContact({ ...good, name: '' }).ok).toBe(false);
  });
});
