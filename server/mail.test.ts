import { describe, expect, it } from 'vitest';
import { launchWelcomeMail } from '../shared/mailTemplates.js';
import { isMailAddress, mailConfig, sendMail } from './mail.js';

const cfg = { apiKey: 'k', from: 'Kaayra Herbals <no-reply@kaayraherbals.com>', ownerTo: 'o@kaayraherbals.com', replyTo: 'o@kaayraherbals.com', autoReply: true };

describe('mailConfig', () => {
  it('is null without an API key', () => {
    expect(mailConfig({})).toBeNull();
    expect(mailConfig({ RESEND_API_KEY: '  ' })).toBeNull();
  });
  it('defaults sender, owner and reply-to', () => {
    const c = mailConfig({ RESEND_API_KEY: 'k', ADMIN_EMAILS: 'Owner@Example.com, other@example.com' });
    expect(c?.from).toBe('Kaayra Herbals <no-reply@kaayraherbals.com>');
    expect(c?.ownerTo).toBe('owner@example.com');
    expect(c?.replyTo).toBe('owner@example.com');
    expect(c?.autoReply).toBe(true);
  });
  it('rejects a malformed sender or owner and falls back safely', () => {
    const c = mailConfig({ RESEND_API_KEY: 'k', MAIL_FROM: 'x\r\nBcc: evil@e.com', MAIL_OWNER_TO: 'not an address' });
    expect(c?.from).toBe('Kaayra Herbals <no-reply@kaayraherbals.com>');
    expect(c?.ownerTo).toBeNull();
  });
  it('MAIL_AUTOREPLY=off disables the receipt', () => {
    expect(mailConfig({ RESEND_API_KEY: 'k', MAIL_AUTOREPLY: 'off' })?.autoReply).toBe(false);
  });
});

describe('isMailAddress', () => {
  it('accepts normal and rejects injection attempts', () => {
    expect(isMailAddress('a@b.co')).toBe(true);
    for (const bad of ['', 'a@b', 'a b@c.com', 'a@b.com,c@d.com', 'a@b.com\r\nBcc: x@y.z', '<a@b.com>']) expect(isMailAddress(bad)).toBe(false);
  });
});

describe('sendMail', () => {
  it('skips when not configured, without calling the network', async () => {
    let called = false;
    const r = await sendMail(null, null, 'a@b.co', launchWelcomeMail({}), { fetchImpl: (async () => { called = true; return new Response('{}'); }) as typeof fetch });
    expect(r.status).toBe('skipped');
    expect(called).toBe(false);
  });
  it('skips a bad recipient', async () => {
    const r = await sendMail(null, cfg, 'a@b.com\r\nBcc: x@y.z', launchWelcomeMail({}));
    expect(r).toEqual({ status: 'skipped', reason: 'bad_recipient' });
  });
  it('sends the expected request and reports the id', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ id: 'em_123' }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await sendMail(null, cfg, 'visitor@example.com', launchWelcomeMail({ name: 'Asha' }), { replyTo: 'o@kaayraherbals.com', fetchImpl: f });
    expect(r).toEqual({ status: 'sent', id: 'em_123' });
    const s = seen as unknown as { url: string; init: RequestInit };
    expect(s.url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(s.init.body));
    expect(body.to).toEqual(['visitor@example.com']);
    expect(body.reply_to).toBe('o@kaayraherbals.com');
    expect(body.subject).toBe('You are on the Kaayra Herbals list');
    expect((s.init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect((s.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });
  it('turns a provider error into a failure without throwing or echoing the response', async () => {
    const f = (async () => new Response('{"message":"bad address visitor@example.com"}', { status: 422 })) as unknown as typeof fetch;
    const r = await sendMail(null, cfg, 'visitor@example.com', launchWelcomeMail({}), { fetchImpl: f });
    expect(r).toEqual({ status: 'failed', error: 'http_422' });
  });
  it('turns a network error into a failure', async () => {
    const f = (async () => { throw new Error('boom visitor@example.com'); }) as unknown as typeof fetch;
    const r = await sendMail(null, cfg, 'visitor@example.com', launchWelcomeMail({}), { fetchImpl: f });
    expect(r).toEqual({ status: 'failed', error: 'network' });
  });
});
