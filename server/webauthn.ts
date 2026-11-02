import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

/**
 * Passkeys (WebAuthn), verified with Node's crypto only: no extra packages.
 * Supports ES256 (P-256) and RS256 keys, attestation "none", and requires user presence AND user verification
 * (a fingerprint, face or device PIN), so a passkey sign-in counts as both factors.
 */

export const ALG_ES256 = -7;
export const ALG_RS256 = -257;
export const SUPPORTED_ALGS = [ALG_ES256, ALG_RS256] as const;
export const TICKET_TTL_MS = 3 * 60 * 1000;
export const MAX_CREDENTIAL_ID_BYTES = 1023;

export const b64u = (b: Buffer | Uint8Array): string => Buffer.from(b).toString('base64url');
const B64U_RE = /^[A-Za-z0-9_-]*$/;
/** Decodes base64url strictly; null for anything that is not base64url or is longer than maxBytes. */
export function fromB64u(s: unknown, maxBytes = 8192): Buffer | null {
  if (typeof s !== 'string' || s.length > Math.ceil((maxBytes * 4) / 3) + 4 || !B64U_RE.test(s)) return null;
  const b = Buffer.from(s, 'base64url');
  return b.length <= maxBytes ? b : null;
}
const sha256 = (b: Buffer | string): Buffer => createHash('sha256').update(b).digest();
const safeEq = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

/** Short stable fingerprint of a credential id, kept in the session so removing a passkey ends sessions it created. */
export const credentialHash = (credentialId: string): string => b64u(sha256(credentialId)).slice(0, 22);
/** A stable, non-secret user handle for an email (the account id the authenticator stores). */
export const userHandle = (email: string): string => b64u(sha256(`kaayra-admin|${email.toLowerCase()}`));

// ---- relying party --------------------------------------------------------------------------------------------

export interface RpContext {
  rpId: string;
  origin: string;
}
/** rpId is the site's domain (ADMIN_PASSKEY_RP_ID, or the request host); origin must match what the browser reports. */
export function rpContext(headers: Record<string, string | string[] | undefined>, env: Record<string, string | undefined> = process.env): RpContext | null {
  const host = String(headers.host ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  const hostname = host.replace(/:\d+$/, '');
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  const rpId = (env.ADMIN_PASSKEY_RP_ID ?? '').trim().toLowerCase() || hostname;
  if (hostname !== rpId && !hostname.endsWith(`.${rpId}`)) return null;
  return { rpId, origin: `${local ? 'http' : 'https'}://${host}` };
}

// ---- signed challenge tickets (stateless: no table needed for challenges) ---------------------------------------

export type TicketKind = 'reg' | 'auth';
interface TicketBody {
  k: TicketKind;
  /** Email the ticket is bound to; empty for usernameless sign-in. */
  e: string;
  c: string;
  x: number;
}
const ticketMac = (payload: string, secret: string): Buffer => createHmac('sha256', secret).update(`kaayra-passkey|${payload}`).digest();

export function newChallenge(): string {
  return b64u(randomBytes(32));
}
export function signTicket(kind: TicketKind, email: string, challenge: string, secret: string, nowMs = Date.now()): string {
  const payload = b64u(Buffer.from(JSON.stringify({ k: kind, e: email.toLowerCase(), c: challenge, x: nowMs + TICKET_TTL_MS } satisfies TicketBody)));
  return `${payload}.${b64u(ticketMac(payload, secret))}`;
}
/** Returns the challenge and bound email when the ticket is genuine, unexpired and of the right kind. */
export function readTicket(ticket: unknown, kind: TicketKind, secret: string, nowMs = Date.now()): { challenge: string; email: string } | null {
  if (typeof ticket !== 'string' || ticket.length > 1024) return null;
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;
  const sig = fromB64u(parts[1], 64);
  if (!sig || !safeEq(sig, ticketMac(parts[0], secret))) return null;
  try {
    const t = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Partial<TicketBody>;
    if (t.k !== kind || typeof t.c !== 'string' || typeof t.e !== 'string' || typeof t.x !== 'number' || t.x < nowMs) return null;
    return { challenge: t.c, email: t.e };
  } catch {
    return null;
  }
}
/** Credential id shown for an address with no passkeys, so "has passkeys" cannot be probed from the response shape. */
export const decoyCredentialId = (email: string, secret: string): string => b64u(createHmac('sha256', secret).update(`kaayra-passkey-decoy|${email.toLowerCase()}`).digest());

// ---- CBOR (only what WebAuthn needs) -------------------------------------------------------------------------

export function cborDecode(buf: Buffer, offset = 0, depth = 0): [unknown, number] {
  if (depth > 6 || offset >= buf.length) throw new Error('cbor');
  const ib = buf[offset];
  const major = ib >> 5;
  const info = ib & 31;
  let pos = offset + 1;
  let n: number;
  if (info < 24) n = info;
  else if (info === 24) {
    n = buf.readUInt8(pos);
    pos += 1;
  } else if (info === 25) {
    n = buf.readUInt16BE(pos);
    pos += 2;
  } else if (info === 26) {
    n = buf.readUInt32BE(pos);
    pos += 4;
  } else if (info === 27) {
    const big = buf.readBigUInt64BE(pos);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('cbor');
    n = Number(big);
    pos += 8;
  } else throw new Error('cbor');
  switch (major) {
    case 0:
      return [n, pos];
    case 1:
      return [-1 - n, pos];
    case 2:
    case 3: {
      if (pos + n > buf.length) throw new Error('cbor');
      const slice = buf.subarray(pos, pos + n);
      return [major === 2 ? Buffer.from(slice) : slice.toString('utf8'), pos + n];
    }
    case 4: {
      if (n > 64) throw new Error('cbor');
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const [v, next] = cborDecode(buf, pos, depth + 1);
        out.push(v);
        pos = next;
      }
      return [out, pos];
    }
    case 5: {
      if (n > 64) throw new Error('cbor');
      const out = new Map<unknown, unknown>();
      for (let i = 0; i < n; i++) {
        const [k, afterKey] = cborDecode(buf, pos, depth + 1);
        const [v, afterVal] = cborDecode(buf, afterKey, depth + 1);
        out.set(k, v);
        pos = afterVal;
      }
      return [out, pos];
    }
    case 7:
      if (info === 20) return [false, pos];
      if (info === 21) return [true, pos];
      if (info === 22) return [null, pos];
      throw new Error('cbor');
    default:
      throw new Error('cbor');
  }
}

// ---- authenticator data ---------------------------------------------------------------------------------------

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_BE = 0x08;
export const FLAG_BS = 0x10;
export const FLAG_AT = 0x40;

export interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  counter: number;
  credentialId?: Buffer;
  coseKey?: Map<unknown, unknown>;
}
export function parseAuthData(buf: Buffer): AuthData {
  if (buf.length < 37) throw new Error('authData');
  const out: AuthData = { rpIdHash: buf.subarray(0, 32), flags: buf[32], counter: buf.readUInt32BE(33) };
  if (out.flags & FLAG_AT) {
    if (buf.length < 55) throw new Error('authData');
    const len = buf.readUInt16BE(53);
    if (len < 1 || len > MAX_CREDENTIAL_ID_BYTES || buf.length < 55 + len) throw new Error('authData');
    out.credentialId = Buffer.from(buf.subarray(55, 55 + len));
    const [key] = cborDecode(buf, 55 + len);
    if (!(key instanceof Map)) throw new Error('authData');
    out.coseKey = key;
  }
  return out;
}

/** COSE key to SPKI (base64url), or null when the key type or curve is not supported. */
export function coseToSpki(key: Map<unknown, unknown>): { spki: string; alg: number } | null {
  const kty = key.get(1);
  const alg = key.get(3);
  try {
    if (kty === 2 && alg === ALG_ES256 && key.get(-1) === 1) {
      const x = key.get(-2);
      const y = key.get(-3);
      if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) return null;
      const k = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) }, format: 'jwk' });
      return { spki: b64u(k.export({ type: 'spki', format: 'der' })), alg: ALG_ES256 };
    }
    if (kty === 3 && alg === ALG_RS256) {
      const n = key.get(-1);
      const e = key.get(-2);
      if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256 || n.length > 1024 || e.length < 1 || e.length > 8) return null;
      const k = createPublicKey({ key: { kty: 'RSA', n: b64u(n), e: b64u(e) }, format: 'jwk' });
      return { spki: b64u(k.export({ type: 'spki', format: 'der' })), alg: ALG_RS256 };
    }
  } catch {
    return null;
  }
  return null;
}

// ---- verification -------------------------------------------------------------------------------------------

export type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

function checkClientData(raw: unknown, type: string, challenge: string, origin: string): Buffer | Fail {
  const bytes = fromB64u(raw, 4096);
  if (!bytes) return fail('clientDataJSON is not valid');
  let cd: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    cd = JSON.parse(bytes.toString('utf8'));
  } catch {
    return fail('clientDataJSON is not JSON');
  }
  if (cd.type !== type) return fail('wrong ceremony type');
  if (typeof cd.challenge !== 'string' || !safeEq(Buffer.from(cd.challenge), Buffer.from(challenge))) return fail('challenge does not match');
  if (cd.origin !== origin) return fail('origin does not match');
  if (cd.crossOrigin === true) return fail('cross-origin request');
  return bytes;
}
function checkFlags(a: AuthData, rpId: string): Fail | null {
  if (!safeEq(a.rpIdHash, sha256(rpId))) return fail('relying party does not match');
  if (!(a.flags & FLAG_UP)) return fail('user presence missing');
  if (!(a.flags & FLAG_UV)) return fail('user verification missing');
  return null;
}

export interface RegistrationInput {
  clientDataJSON: unknown;
  attestationObject: unknown;
  rawId: unknown;
  challenge: string;
  rp: RpContext;
}
export type RegistrationResult = { ok: true; credentialId: string; publicKey: string; alg: number; signCount: number; backupEligible: boolean; backedUp: boolean } | Fail;

export function verifyRegistration(input: RegistrationInput): RegistrationResult {
  const cd = checkClientData(input.clientDataJSON, 'webauthn.create', input.challenge, input.rp.origin);
  if (!Buffer.isBuffer(cd)) return cd;
  const att = fromB64u(input.attestationObject, 16384);
  if (!att) return fail('attestationObject is not valid');
  let authData: AuthData;
  try {
    const [obj] = cborDecode(att);
    const raw = obj instanceof Map ? obj.get('authData') : null;
    if (!Buffer.isBuffer(raw)) return fail('authData missing');
    authData = parseAuthData(raw);
  } catch {
    return fail('attestationObject could not be read');
  }
  const bad = checkFlags(authData, input.rp.rpId);
  if (bad) return bad;
  if (!authData.credentialId || !authData.coseKey) return fail('no credential in response');
  const rawId = fromB64u(input.rawId, MAX_CREDENTIAL_ID_BYTES);
  if (!rawId || !safeEq(rawId, authData.credentialId)) return fail('credential id mismatch');
  const key = coseToSpki(authData.coseKey);
  if (!key) return fail('unsupported key type');
  return { ok: true, credentialId: b64u(authData.credentialId), publicKey: key.spki, alg: key.alg, signCount: authData.counter, backupEligible: Boolean(authData.flags & FLAG_BE), backedUp: Boolean(authData.flags & FLAG_BS) };
}

export interface AssertionInput {
  clientDataJSON: unknown;
  authenticatorData: unknown;
  signature: unknown;
  challenge: string;
  rp: RpContext;
  publicKey: string;
  alg: number;
  storedCount: number;
}
export type AssertionResult = { ok: true; signCount: number; backedUp: boolean } | Fail;

export function verifyAssertion(input: AssertionInput): AssertionResult {
  const cd = checkClientData(input.clientDataJSON, 'webauthn.get', input.challenge, input.rp.origin);
  if (!Buffer.isBuffer(cd)) return cd;
  const adBytes = fromB64u(input.authenticatorData, 2048);
  const sig = fromB64u(input.signature, 1024);
  if (!adBytes || !sig) return fail('assertion is not valid');
  let ad: AuthData;
  try {
    ad = parseAuthData(adBytes);
  } catch {
    return fail('authenticatorData could not be read');
  }
  const bad = checkFlags(ad, input.rp.rpId);
  if (bad) return bad;
  if (!(SUPPORTED_ALGS as readonly number[]).includes(input.alg)) return fail('unsupported key type');
  let ok = false;
  try {
    const key = createPublicKey({ key: Buffer.from(input.publicKey, 'base64url'), format: 'der', type: 'spki' });
    ok = cryptoVerify('sha256', Buffer.concat([adBytes, sha256(cd)]), key, sig);
  } catch {
    ok = false;
  }
  if (!ok) return fail('signature is not valid');
  // A counter that goes backwards suggests a cloned authenticator. Many synced passkeys always report 0, which is fine.
  if ((ad.counter !== 0 || input.storedCount !== 0) && ad.counter <= input.storedCount) return fail('signature counter went backwards');
  return { ok: true, signCount: ad.counter, backedUp: Boolean(ad.flags & FLAG_BS) };
}
