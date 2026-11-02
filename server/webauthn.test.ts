import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { b64u, cborDecode, credentialHash, decoyCredentialId, fromB64u, newChallenge, readTicket, rpContext, signTicket, verifyAssertion, verifyRegistration, userHandle } from './webauthn.js';
import { FLAGS_OK, RP, assertion, cbor, clientData, ec, registration, rsa } from './webauthn-testkit.js';

describe('registration', () => {
  it('accepts a valid ES256 passkey and returns a usable public key', () => {
    const ch = newChallenge();
    const r = verifyRegistration(registration({ challenge: ch }).input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.alg).toBe(-7);
      expect(r.signCount).toBe(0);
      expect(fromB64u(r.publicKey)?.length).toBeGreaterThan(60);
    }
  });
  it('accepts an RS256 passkey', () => {
    const r = verifyRegistration(registration({ challenge: 'abc', cose: rsa().cose }).input);
    expect(r.ok && r.alg).toBe(-257);
  });
  it('refuses a wrong challenge, origin, relying party, ceremony type and missing verification', () => {
    const ch = newChallenge();
    expect(verifyRegistration({ ...registration({ challenge: ch }).input, challenge: 'other' }).ok).toBe(false);
    expect(verifyRegistration(registration({ challenge: ch, origin: 'https://evil.example' }).input).ok).toBe(false);
    expect(verifyRegistration(registration({ challenge: ch, rpId: 'evil.example' }).input).ok).toBe(false);
    expect(verifyRegistration(registration({ challenge: ch, flags: 0x01 | 0x40 }).input).ok).toBe(false); // no user verification
    expect(verifyRegistration(registration({ challenge: ch, flags: 0x04 | 0x40 }).input).ok).toBe(false); // no user presence
    expect(verifyRegistration(registration({ challenge: ch, flags: FLAGS_OK }).input).ok).toBe(false); // no credential data
    const wrongType = registration({ challenge: ch }).input;
    wrongType.clientDataJSON = b64u(clientData('webauthn.get', ch));
    expect(verifyRegistration(wrongType).ok).toBe(false);
  });
  it('refuses a credential id that does not match, and unsupported key types', () => {
    const r = registration({ challenge: 'c' });
    expect(verifyRegistration({ ...r.input, rawId: b64u(randomBytes(32)) }).ok).toBe(false);
    const odd = new Map<unknown, unknown>([[1, 2], [3, -8], [-1, 6], [-2, randomBytes(32)], [-3, randomBytes(32)]]);
    expect(verifyRegistration(registration({ challenge: 'c', cose: odd }).input).ok).toBe(false);
  });
  it('rejects garbage without throwing', () => {
    expect(verifyRegistration({ clientDataJSON: 'x', attestationObject: '!!', rawId: 1, challenge: 'c', rp: RP }).ok).toBe(false);
    expect(verifyRegistration({ clientDataJSON: b64u(clientData('webauthn.create', 'c')), attestationObject: b64u(Buffer.from([0xff, 0xff])), rawId: 'AA', challenge: 'c', rp: RP }).ok).toBe(false);
  });
});

describe('assertion (sign-in)', () => {
  const ecKey = ec();
  const publicKeyOf = (cose: Map<unknown, unknown>) => {
    const reg = verifyRegistration(registration({ challenge: 'k', cose }).input);
    if (!reg.ok) throw new Error('setup');
    return reg.publicKey;
  };
  const ecPublic = publicKeyOf(ecKey.cose);

  it('accepts a correct ES256 signature', () => {
    const r = verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c1', count: 0 }));
    expect(r.ok).toBe(true);
  });
  it('accepts a correct RS256 signature', () => {
    const k = rsa();
    expect(verifyAssertion(assertion(k, publicKeyOf(k.cose), { challenge: 'c2' })).ok).toBe(true);
  });
  it('refuses a signature from a different key', () => {
    const other = ec();
    expect(verifyAssertion(assertion(other, ecPublic, { challenge: 'c3' })).ok).toBe(false);
  });
  it('refuses a changed challenge, origin, relying party and ceremony type', () => {
    const good = assertion(ecKey, ecPublic, { challenge: 'c4' });
    expect(verifyAssertion({ ...good, challenge: 'different' }).ok).toBe(false);
    expect(verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c4', origin: 'https://evil.example' })).ok).toBe(false);
    expect(verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c4', rpId: 'evil.example' })).ok).toBe(false);
    expect(verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c4', type: 'webauthn.create' })).ok).toBe(false);
  });
  it('requires user presence and user verification', () => {
    expect(verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c5', flags: 0x01 })).ok).toBe(false);
    expect(verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c5', flags: 0x04 })).ok).toBe(false);
  });
  it('detects a counter that goes backwards but allows counters that stay at zero', () => {
    expect(verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c6', count: 5, storedCount: 5 })).ok).toBe(false);
    expect(verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c6', count: 4, storedCount: 5 })).ok).toBe(false);
    const up = verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c6', count: 6, storedCount: 5 }));
    expect(up.ok && up.signCount).toBe(6);
    expect(verifyAssertion(assertion(ecKey, ecPublic, { challenge: 'c6', count: 0, storedCount: 0 })).ok).toBe(true);
  });
  it('refuses a tampered authenticator response', () => {
    const good = assertion(ecKey, ecPublic, { challenge: 'c7' });
    const bytes = Buffer.from(good.authenticatorData, 'base64url');
    bytes[33] ^= 1; // flip a counter bit
    expect(verifyAssertion({ ...good, authenticatorData: b64u(bytes) }).ok).toBe(false);
    expect(verifyAssertion({ ...good, signature: 'AAAA' }).ok).toBe(false);
    expect(verifyAssertion({ ...good, publicKey: 'AAAA' }).ok).toBe(false);
  });
});

describe('tickets', () => {
  const secret = 't'.repeat(40);
  it('round-trips and binds kind, email and time', () => {
    const t = signTicket('auth', 'Boss@Kaayra.in', 'chal', secret, 1_000);
    expect(readTicket(t, 'auth', secret, 2_000)).toEqual({ challenge: 'chal', email: 'boss@kaayra.in' });
    expect(readTicket(t, 'reg', secret, 2_000)).toBeNull();
    expect(readTicket(t, 'auth', 'x'.repeat(40), 2_000)).toBeNull();
    expect(readTicket(t, 'auth', secret, 1_000 + 4 * 60 * 1000)).toBeNull();
    expect(readTicket(`${t}x`, 'auth', secret, 2_000)).toBeNull();
    expect(readTicket(undefined, 'auth', secret)).toBeNull();
  });
});

describe('helpers', () => {
  it('derives the relying party from the host, with an optional override', () => {
    expect(rpContext({ host: 'kaayra.in' }, {})).toEqual({ rpId: 'kaayra.in', origin: 'https://kaayra.in' });
    expect(rpContext({ host: 'localhost:3000' }, {})).toEqual({ rpId: 'localhost', origin: 'http://localhost:3000' });
    expect(rpContext({ host: 'www.kaayra.in' }, { ADMIN_PASSKEY_RP_ID: 'kaayra.in' })).toEqual({ rpId: 'kaayra.in', origin: 'https://www.kaayra.in' });
    expect(rpContext({ host: 'evil.com' }, { ADMIN_PASSKEY_RP_ID: 'kaayra.in' })).toBeNull();
    expect(rpContext({ host: 'bad host!' }, {})).toBeNull();
    expect(rpContext({}, {})).toBeNull();
  });
  it('decodes CBOR safely and rejects junk', () => {
    expect(cborDecode(cbor(new Map<unknown, unknown>([['a', 1], [-1, Buffer.from([1, 2])]])))[0]).toEqual(new Map<unknown, unknown>([['a', 1], [-1, Buffer.from([1, 2])]]));
    expect(() => cborDecode(Buffer.from([0x5f]))).toThrow();
    expect(() => cborDecode(Buffer.from([0x58, 0xff, 1]))).toThrow();
    expect(() => cborDecode(Buffer.alloc(0))).toThrow();
  });
  it('is strict about base64url and gives stable, distinct fingerprints and decoys', () => {
    expect(fromB64u('a+b')).toBeNull();
    expect(fromB64u('AAAA', 2)).toBeNull();
    expect(fromB64u(5)).toBeNull();
    expect(credentialHash('abc')).toBe(credentialHash('abc'));
    expect(credentialHash('abc')).not.toBe(credentialHash('abd'));
    expect(decoyCredentialId('a@b.c', 'k'.repeat(40))).toBe(decoyCredentialId('A@B.c', 'k'.repeat(40)));
    expect(decoyCredentialId('a@b.c', 'k'.repeat(40))).not.toBe(decoyCredentialId('x@b.c', 'k'.repeat(40)));
    expect(userHandle('A@b.c')).toBe(userHandle('a@b.c'));
  });
});
