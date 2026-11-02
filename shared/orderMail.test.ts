import { describe, expect, it } from 'vitest';
import { ORDER_MAIL_BUILDERS, ORDER_MAIL_KINDS, rupees } from './orderMail.js';

const hostile = '<script>alert(1)</script>\r\nBcc: evil@example.com';
const P = { name: hostile, orderNo: 'KH-2026-000042', totalPaise: 105800, items: [{ name: 'Test <b>syrup</b>', packSize: '200 ml', qty: 2 }], courier: 'Test Courier', trackingNo: 'TRK123', refundPaise: 50000, supportEmail: 'help@kaayraherbals.example' };

describe('order mail templates', () => {
  it('has exactly the ten required kinds', () => {
    expect([...ORDER_MAIL_KINDS].sort()).toEqual(['delivered', 'order_cancelled', 'order_created', 'out_for_delivery', 'payment_confirmed', 'payment_failed', 'refund_completed', 'refund_initiated', 'return_received', 'shipment_dispatched']);
  });
  for (const kind of ORDER_MAIL_KINDS) {
    describe(kind, () => {
      const m = ORDER_MAIL_BUILDERS[kind](P);
      it('has a fixed single-line subject with no customer text', () => {
        expect(m.subject).not.toMatch(/[\r\n<>]/);
        expect(m.subject).not.toContain('evil');
        expect(m.kind).toBe(kind);
      });
      it('has HTML and plain text, both with the order reference and the support contact', () => {
        expect(m.html).toContain('KH-2026-000042');
        expect(m.text).toContain('KH-2026-000042');
        expect(m.html).toContain('help@kaayraherbals.example');
        expect(m.text).toContain('help@kaayraherbals.example');
        expect(m.text.length).toBeGreaterThan(40);
        expect(m.html).toMatch(/<html lang="en">/);
      });
      it('escapes hostile customer text in HTML', () => {
        expect(m.html).not.toContain('<script>');
        expect(m.html).not.toContain('<b>syrup');
      });
      it('carries no address, phone, price promise or health claim', () => {
        expect(`${m.html} ${m.text}`).not.toMatch(/pincode|\+91|cure|treat|guarantee|within \d+ (days|hours)/i);
      });
    });
  }
  it('uses a fallback when no support address is configured', () => {
    expect(ORDER_MAIL_BUILDERS.delivered({ orderNo: 'KH-2026-000042' }).text).toContain('reply to this email');
  });
  it('rejects a malformed order reference', () => {
    expect(() => ORDER_MAIL_BUILDERS.delivered({ orderNo: 'x<script>' })).toThrow();
  });
  it('says a refund is STARTED, and only the completed mail says it was confirmed', () => {
    const started = ORDER_MAIL_BUILDERS.refund_initiated(P);
    const done = ORDER_MAIL_BUILDERS.refund_completed(P);
    expect(started.text).toMatch(/started a refund/i);
    expect(started.text).not.toMatch(/has been (processed|completed|refunded)|confirmed your refund/i);
    expect(done.text).toMatch(/payment provider has confirmed/i);
  });
  it('lists tracking details only in shipping mails', () => {
    expect(ORDER_MAIL_BUILDERS.shipment_dispatched(P).text).toContain('TRK123');
    expect(ORDER_MAIL_BUILDERS.payment_confirmed(P).text).not.toContain('TRK123');
  });
  it('formats rupees in the Indian style', () => {
    expect(rupees(105800)).toBe('\u20B91,058.00');
    expect(rupees(5)).toBe('\u20B90.05');
  });
});
