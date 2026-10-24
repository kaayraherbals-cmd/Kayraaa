import { api, errorText } from './adminKit';

/** Browser side of passkeys (WebAuthn). The server does all the checking; this only talks to the device and the API. */
const toBuf = (s: string): ArrayBuffer => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const toB64u = (buf: ArrayBuffer | null | undefined): string => {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

interface WireDescriptor {
  type: 'public-key';
  id: string;
  transports?: string[];
}
interface CreateWire {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation: 'none';
  authenticatorSelection: { residentKey: 'preferred'; userVerification: 'required' };
  excludeCredentials: WireDescriptor[];
}
interface GetWire {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: 'required';
  allowCredentials: WireDescriptor[];
}
export type PasskeyOutcome = { ok: true } | { ok: false; message: string; expired?: boolean };

const descriptors = (list: WireDescriptor[]): PublicKeyCredentialDescriptor[] => list.map((d) => ({ type: 'public-key', id: toBuf(d.id), transports: d.transports as AuthenticatorTransport[] | undefined }));

export const passkeysSupported = (): boolean => typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined' && Boolean(navigator.credentials);

function friendly(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'The passkey prompt was cancelled or timed out. Try again.';
  if (name === 'InvalidStateError') return 'This device already has a passkey saved for this account.';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'This browser or address cannot use passkeys here. Use your password instead.';
  return 'The passkey step failed. Try again, or use your password.';
}

/** Adds a passkey to the signed-in admin's account. */
export async function addPasskey(name: string): Promise<PasskeyOutcome> {
  if (!passkeysSupported()) return { ok: false, message: 'This browser does not support passkeys.' };
  const begin = await api<{ ticket: string; options: CreateWire }>('passkey-register-begin', { method: 'POST', body: {} });
  if (begin.status === 401) return { ok: false, message: 'Your session ended. Sign in again.', expired: true };
  if (!begin.ok || !begin.data?.options) return { ok: false, message: errorText(begin, 'Could not start adding a passkey.') };
  const o = begin.data.options;
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: toBuf(o.challenge),
        rp: o.rp,
        user: { id: toBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
        pubKeyCredParams: o.pubKeyCredParams,
        timeout: o.timeout,
        attestation: o.attestation,
        authenticatorSelection: o.authenticatorSelection,
        excludeCredentials: descriptors(o.excludeCredentials),
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    return { ok: false, message: friendly(e) };
  }
  if (!cred) return { ok: false, message: 'No passkey was created.' };
  const att = cred.response as AuthenticatorAttestationResponse;
  const done = await api('passkey-register-finish', {
    method: 'POST',
    body: {
      ticket: begin.data.ticket,
      name,
      credential: { id: cred.id, rawId: toB64u(cred.rawId), response: { clientDataJSON: toB64u(att.clientDataJSON), attestationObject: toB64u(att.attestationObject), transports: att.getTransports?.() ?? [] } },
    },
  });
  if (done.status === 401) return { ok: false, message: 'Your session ended. Sign in again.', expired: true };
  return done.ok ? { ok: true } : { ok: false, message: errorText(done, 'Could not save the passkey.') };
}

/** Signs in with a passkey. With an email the server lists that admin's passkeys; without one the browser offers any passkey saved for this site. */
export async function signInWithPasskey(email: string): Promise<PasskeyOutcome> {
  if (!passkeysSupported()) return { ok: false, message: 'This browser does not support passkeys. Use your password instead.' };
  const begin = await api<{ ticket: string; options: GetWire }>('passkey-login-begin', { method: 'POST', body: { email } });
  if (!begin.ok || !begin.data?.options) return { ok: false, message: errorText(begin, 'Could not start passkey sign-in.') };
  const o = begin.data.options;
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({ publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification, allowCredentials: descriptors(o.allowCredentials) } })) as PublicKeyCredential | null;
  } catch (e) {
    return { ok: false, message: friendly(e) };
  }
  if (!cred) return { ok: false, message: 'No passkey was chosen.' };
  const res = cred.response as AuthenticatorAssertionResponse;
  const done = await api('passkey-login-finish', {
    method: 'POST',
    body: {
      ticket: begin.data.ticket,
      email,
      credential: { id: cred.id, rawId: toB64u(cred.rawId), response: { clientDataJSON: toB64u(res.clientDataJSON), authenticatorData: toB64u(res.authenticatorData), signature: toB64u(res.signature), userHandle: toB64u(res.userHandle) } },
    },
  });
  return done.ok ? { ok: true } : { ok: false, message: errorText(done, 'That passkey did not work.') };
}
