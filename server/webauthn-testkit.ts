import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { b64u, type RpContext } from './webauthn.js';

/** Test-only software authenticator: builds real WebAuthn byte formats so the tests exercise the real parsing. */
export const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
export function cbor(v: unknown): Buffer {
  const head = (major: number, n: number): Buffer => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor test encoder');
}
export const RP: RpContext = { rpId: 'admin.kaayra.in', origin: 'https://admin.kaayra.in' };
export const FLAGS_OK = 0x01 | 0x04; // user present + user verified

export function ec() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const cose = new Map<unknown, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  return { privateKey, cose, alg: -7 };
}
export function rsa() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  const cose = new Map<unknown, unknown>([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]]);
  return { privateKey, cose, alg: -257 };
}
export const counterBuf = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
export function clientData(type: string, challenge: string, origin = RP.origin) {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}
export function registration(opts: { challenge: string; flags?: number; origin?: string; rpId?: string; cose?: Map<unknown, unknown>; credId?: Buffer; fmt?: string }) {
  const credId = opts.credId ?? randomBytes(32);
  const authData = Buffer.concat([sha(opts.rpId ?? RP.rpId), Buffer.from([opts.flags ?? FLAGS_OK | 0x40]), counterBuf(0), Buffer.alloc(16), Buffer.from([credId.length >> 8, credId.length & 255]), credId, cbor(opts.cose ?? ec().cose)]);
  const att = cbor(new Map<unknown, unknown>([['fmt', opts.fmt ?? 'none'], ['attStmt', new Map()], ['authData', authData]]));
  return { credId, input: { clientDataJSON: b64u(clientData('webauthn.create', opts.challenge, opts.origin)), attestationObject: b64u(att), rawId: b64u(credId), challenge: opts.challenge, rp: RP } };
}
export function assertion(key: { privateKey: KeyObject; alg: number }, publicKey: string, o: { challenge: string; count?: number; flags?: number; rpId?: string; origin?: string; storedCount?: number; type?: string }) {
  const authData = Buffer.concat([sha(o.rpId ?? RP.rpId), Buffer.from([o.flags ?? FLAGS_OK]), counterBuf(o.count ?? 0)]);
  const cd = clientData(o.type ?? 'webauthn.get', o.challenge, o.origin);
  const signer = createSign('sha256');
  signer.update(Buffer.concat([authData, sha(cd)]));
  const signature = signer.sign(key.privateKey);
  return { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature), challenge: o.challenge, rp: RP, publicKey, alg: key.alg, storedCount: o.storedCount ?? 0 };
}

