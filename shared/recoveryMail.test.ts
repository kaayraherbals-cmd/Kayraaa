import { describe, expect, it } from 'vitest';
import { RECOVERY_SUBJECTS, recoveryMail, type RecoveryMailParams } from './recoveryMail.js';

const base: RecoveryMailParams = {
  step: 1, name: 'Asha Verma',
  lines: [{ variantId: '11111111-1111-4111-8111-111111111111', productName: 'Tulsi syrup', packSize: '200 ml', qty: 2, unitPaise: 49900, lineTotalPaise: 99800, reduced: false }],
  unavailable: [], restoreUrl: 'https://kaayra.test/bag?recover=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde', unsubscribeUrl: 'https://kaayra.test/subscription?a=cart-unsubscribe&t=tok',
  oneClickUrl: 'https://kaayra.test/api/cart/unsubscribe?u=tok', senderLine: 'Kaayra Herbals Private Limited, 1 Test Road, Pune',
};
const FORBIDDEN = /hurry|last chance|selling (fast|out)|only \d+ left|running out|limited time|don.t miss|expires? (soon|today)|discount|% off|coupon|sale\b|cure|treat|heal|prevent|diagnos|clinically|guaranteed/i;

describe('recovery emails', () => {
  it('use exactly the requested subjects', () => {
    expect(recoveryMail({ ...base, step: 1 }).subject).toBe('Your Kaayra Herbals cart is waiting 🌿');
    expect(recoveryMail({ ...base, step: 2 }).subject).toBe('Still thinking about your Kaayra picks?');
    expect(recoveryMail({ ...base, step: 3 }).subject).toBe('Your saved Kaayra Herbals items');
    expect(Object.keys(RECOVERY_SUBJECTS)).toHaveLength(3);
  });
  it('map to their own kind', () => {
    expect([1, 2, 3].map((s) => recoveryMail({ ...base, step: s as 1 | 2 | 3 }).kind)).toEqual(['cart_recovery_1', 'cart_recovery_2', 'cart_recovery_3']);
  });
  it('carry an unsubscribe link in the body, the text part and the one-click headers', () => {
    const m = recoveryMail(base);
    expect(m.html).toContain('Unsubscribe');
    expect(m.html).toContain(base.unsubscribeUrl.replace('&', '&amp;'));
    expect(m.text).toContain(base.unsubscribeUrl);
    expect(m.headers?.['List-Unsubscribe']).toBe(`<${base.oneClickUrl}>`);
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
  it('have no urgency, scarcity, discount or health claims, in any step, html or text', () => {
    for (const step of [1, 2, 3] as const) {
      const m = recoveryMail({ ...base, step, unavailable: [{ productName: 'Old item', packSize: '1 l' }] });
      expect(FORBIDDEN.test(m.html)).toBe(false);
      expect(FORBIDDEN.test(m.text)).toBe(false);
      expect(FORBIDDEN.test(m.subject)).toBe(false);
    }
  });
  it('show today\'s price, say it is re-checked, and do not promise to hold items', () => {
    const m = recoveryMail(base);
    expect(m.text).toContain('₹998');
    expect(m.text).toMatch(/confirmed again at checkout/);
    expect(m.text).toMatch(/not held for you/);
  });
  it('put only a token in the restore link: no email, no names, no amounts', () => {
    const m = recoveryMail(base);
    const url = /https:\/\/kaayra\.test\/bag\?recover=[A-Za-z0-9_-]{43}/.exec(m.text)?.[0] ?? '';
    expect(url).toBeTruthy();
    expect(url).not.toMatch(/@|asha|tulsi|998/i);
  });
  it('final reminder says it is the last and that nothing more will follow', () => {
    expect(recoveryMail({ ...base, step: 3 }).text).toMatch(/last reminder/);
  });
  it('escape product and customer names (no HTML injection) and keep subjects free of customer text', () => {
    const m = recoveryMail({ ...base, name: '<img src=x onerror=1>', lines: [{ ...base.lines[0]!, productName: '<script>alert(1)</script>' }] });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<img');
    expect(m.subject).not.toMatch(/script|img/);
  });
  it('includes the sender line only when configured, and a note about unavailable items without pressure', () => {
    expect(recoveryMail(base).text).toContain('Kaayra Herbals Private Limited');
    expect(recoveryMail({ ...base, senderLine: null }).text).not.toContain('Private Limited');
    expect(recoveryMail({ ...base, unavailable: [{ productName: 'Old item', packSize: '1 l' }] }).text).toMatch(/not available to order right now/);
  });
  it('has an HTML and a plain-text part', () => {
    const m = recoveryMail(base);
    expect(m.html.length).toBeGreaterThan(200);
    expect(m.text.length).toBeGreaterThan(100);
  });
});
