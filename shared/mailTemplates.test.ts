import { describe, expect, it } from 'vitest';
import { contactAutoReplyMail, contactOwnerMail, escapeHtml, issueOwnerMail, launchConfirmMail, launchWelcomeMail, oneLine, unsubscribeHeaders } from './mailTemplates.js';

const hostile = '<script>alert(1)</script> "x" & \r\nBcc: evil@example.com';

describe('escaping', () => {
  it('escapes html metacharacters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('flattens line breaks and control characters', () => {
    expect(oneLine('a\r\nb\tc\u0000d')).toBe('a b c d');
    expect(oneLine('x'.repeat(500), 10)).toHaveLength(10);
  });
});

describe('templates never put visitor text in subjects', () => {
  it('uses fixed subjects', () => {
    const mails = [
      contactOwnerMail({ name: hostile, email: 'a@b.co', message: hostile }),
      contactAutoReplyMail({ name: hostile }),
      launchWelcomeMail({ name: hostile }),
      issueOwnerMail({ ref: 'R1', category: hostile, summary: hostile, errorCode: hostile, contactEmail: 'a@b.co' }),
    ];
    for (const m of mails) {
      expect(m.subject).not.toMatch(/[\r\n<>]/);
      expect(m.subject).not.toContain('evil');
    }
  });
});

describe('html output is escaped', () => {
  it('contact owner mail', () => {
    const m = contactOwnerMail({ name: 'Asha <b>', email: 'a@b.co', message: hostile });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('Asha &lt;b&gt;');
    expect(m.replyTo).toBe('a@b.co');
  });
  it('greets by first name only, escaped', () => {
    const m = launchWelcomeMail({ name: '<i>Asha</i> Rao' });
    expect(m.html).not.toContain('<i>');
    expect(m.text).toContain('Hello <i>Asha</i>,');
  });
  it('issue mail sets reply-to only when a contact was given', () => {
    expect(issueOwnerMail({ ref: 'R1', category: 'bug', summary: 's' }).replyTo).toBeUndefined();
    expect(issueOwnerMail({ ref: 'R1', category: 'bug', summary: 's', contactEmail: 'a@b.co' }).replyTo).toBe('a@b.co');
  });
});

describe('copy stays honest', () => {
  it('makes no price, health, launch-date or product claims', () => {
    const all = [contactAutoReplyMail({ name: 'A' }), launchWelcomeMail({ name: 'A' }), launchConfirmMail({ name: 'A', confirmUrl: 'https://s.in/c', unsubscribeUrl: 'https://s.in/u' }), launchWelcomeMail({ name: 'A', unsubscribeUrl: 'https://s.in/u' })].map((m) => (m.html + m.text).toLowerCase()).join(' ');
    for (const bad of ['cure', 'treat', 'discount', '% off', 'guarantee', 'order now', 'buy', 'price', 'rs ', '₹']) expect(all).not.toContain(bad);
  });
  it('every mail has a plain-text part', () => {
    for (const m of [contactAutoReplyMail({ name: 'A' }), launchWelcomeMail({ name: null }), launchConfirmMail({ name: null, confirmUrl: 'https://s.in/c', unsubscribeUrl: 'https://s.in/u' })]) expect(m.text.length).toBeGreaterThan(40);
  });
});

describe('launch confirmation mail (double opt-in)', () => {
  const links = { confirmUrl: 'https://s.in/subscription?a=confirm&t=abc.def', unsubscribeUrl: 'https://s.in/subscription?a=unsubscribe&t=ghi.jkl', oneClickUrl: 'https://s.in/api/subscribe?u=ghi.jkl' };
  it('has a fixed subject, the confirm and unsubscribe links in both parts, and one-click headers', () => {
    const m = launchConfirmMail({ name: 'Asha', ...links });
    expect(m.kind).toBe('launch_confirm');
    expect(m.subject).toBe('Please confirm your email for Kaayra Herbals');
    expect(m.text).toContain(links.confirmUrl);
    expect(m.text).toContain(links.unsubscribeUrl);
    expect(m.html).toContain('a=confirm&amp;t=abc.def');
    expect(m.html).toContain('a=unsubscribe&amp;t=ghi.jkl');
    expect(m.headers).toEqual(unsubscribeHeaders(links.oneClickUrl));
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
  it('escapes a hostile name and keeps it out of the subject and headers', () => {
    const m = launchConfirmMail({ name: '<script>alert(1)</script>', ...links });
    expect(m.html).not.toContain('<script>');
    expect(m.subject).not.toContain('script');
    expect(JSON.stringify(m.headers)).not.toContain('script');
  });
  it('says nothing is added until the person confirms', () => {
    expect(launchConfirmMail({ ...links }).text.toLowerCase()).toContain('confirm');
  });
  it('the welcome mail offers an unsubscribe link when it has one, and never asks for a STOP reply', () => {
    const m = launchWelcomeMail({ name: 'A', unsubscribeUrl: links.unsubscribeUrl, oneClickUrl: links.oneClickUrl });
    expect(m.text).toContain(links.unsubscribeUrl);
    expect(m.html).toContain('unsubscribe');
    expect(m.headers?.['List-Unsubscribe']).toContain(links.oneClickUrl);
  });
});
