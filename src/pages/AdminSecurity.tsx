import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { qrMatrix, qrPath } from '../../shared/qr';
import { ROLE_LABELS } from '../../shared/roles';
import { ConfirmDialog, api, errorText, useMe, when } from '../lib/adminKit';
import { addPasskey, passkeysSupported } from '../lib/passkey';

function Qr({ text }: { text: string }) {
  const q = useMemo(() => {
    const m = qrMatrix(text);
    return m ? qrPath(m) : null;
  }, [text]);
  if (!q) return null;
  return (
    <svg className="qr" viewBox={`0 0 ${q.size} ${q.size}`} role="img" aria-label="QR code to scan with your authenticator app" shapeRendering="crispEdges">
      <rect width={q.size} height={q.size} fill="#fff" />
      <path d={q.d} fill="#000" />
    </svg>
  );
}

/** Two-step setup: scan or type the secret, confirm with the first code, then keep the recovery codes. */
export function EnrolFlow({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function begin() {
    setBusy(true);
    setError('');
    const r = await api<{ secret: string; uri: string }>('mfa-begin', { method: 'POST' });
    setBusy(false);
    if (r.ok && r.data?.uri) setSetup({ secret: r.data.secret, uri: r.data.uri });
    else setError(errorText(r, 'Could not start setup.'));
  }
  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    setBusy(true);
    setError('');
    const r = await api<{ recoveryCodes: string[] }>('mfa-confirm', { method: 'POST', body: { code } });
    setBusy(false);
    if (r.ok && r.data?.recoveryCodes) setCodes(r.data.recoveryCodes);
    else setError(errorText(r, 'That code did not work.'));
  }

  if (codes) {
    return (
      <div className="mfa-card">
        <h2>Save your recovery codes</h2>
        <p>Each code works once if you lose your phone. They are shown only now. Store them somewhere safe, such as a password manager.</p>
        <ul className="recovery-codes">
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <div className="admin-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy codes'}
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes
        </label>
        <button type="button" className="btn" disabled={!saved} onClick={onDone}>
          Continue
        </button>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="mfa-card">
        <p>Use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy). You will enter a 6-digit code each time you sign in.</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void begin()}>
          {busy ? 'Starting…' : 'Set up two-step verification'}
        </button>
        {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <form className="mfa-card" onSubmit={confirm}>
      <ol className="mfa-steps">
        <li>
          Scan this code with your authenticator app.
          <Qr text={setup.uri} />
        </li>
        <li>
          Cannot scan? Enter this key by hand (time-based): <code className="mfa-secret">{setup.secret}</code>
        </li>
        <li>
          Type the 6-digit code the app shows.
          <div className="field">
            <label htmlFor="mfa-setup-code">Code</label>
            <input id="mfa-setup-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required />
          </div>
        </li>
      </ol>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Turn on'}
      </button>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
    </form>
  );
}

/** Shown after the password step: enter a code (or a recovery code), or set up two-step first. */
export function MfaGate({ email, step, available, optional, onDone, onExpired }: { email: string; step: 'verify' | 'enroll'; available: boolean; optional: boolean; onDone: () => void; onExpired: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    setBusy(true);
    setError('');
    const r = await api('mfa-verify', { method: 'POST', body: { code } });
    setBusy(false);
    if (r.status === 401 && r.data?.status !== 'mfa_denied') return onExpired();
    if (r.ok) return onDone();
    setError(errorText(r, 'That code did not work.'));
  }

  return (
    <section className="signup admin-login auth-surface" aria-labelledby="mfa-title">
      <h1 id="mfa-title">{step === 'verify' ? 'Two-step verification' : 'Set up two-step verification'}</h1>
      <p className="muted">Signed in as {email}.{step === 'enroll' && !optional ? ' Admin access requires two-step verification.' : ''}</p>
      {step === 'verify' ? (
        <form onSubmit={verify} className="mfa-card">
          <div className="field">
            <label htmlFor="mfa-code">6-digit code from your authenticator app, or a recovery code</label>
            <input id="mfa-code" name="code" autoComplete="one-time-code" autoFocus required maxLength={20} />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
          {error && <p className="form-status form-status--error" role="alert">{error}</p>}
          <p className="field-hint">Lost your phone and your recovery codes? Ask an owner to reset your two-step verification.</p>
        </form>
      ) : available ? (
        <EnrolFlow onDone={onDone} />
      ) : (
        <p className="form-status form-status--error" role="alert">Two-step verification is not available on the server yet (ADMIN_MFA_KEY is missing).</p>
      )}
    </section>
  );
}

interface TeamItem {
  email: string;
  role: 'owner' | 'manager' | 'support';
  mfaEnrolled: boolean;
  passkeyCount: number;
  you: boolean;
}

interface PasskeyItem {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  backed_up: boolean;
  current: boolean;
}

/** Your passkeys: add one (fingerprint, face or device PIN), rename it, or remove it. Only public keys are stored on the server. */
function PasskeyCard({ onExpired }: { onExpired: () => void }) {
  const [items, setItems] = useState<PasskeyItem[] | null>(null);
  const [max, setMax] = useState(10);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<PasskeyItem | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ items: PasskeyItem[]; max: number }>('passkeys');
    if (r.status === 401) return onExpired();
    if (r.ok && r.data) {
      setItems(r.data.items);
      setMax(r.data.max);
    } else setError(errorText(r, 'Could not load your passkeys.'));
  }, [onExpired]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const r = await addPasskey(name.trim());
    setBusy(false);
    if (!r.ok) {
      if (r.expired) return onExpired();
      return setError(r.message);
    }
    setName('');
    setNotice('Passkey added. You can now sign in with it.');
    void load();
  }
  async function rename(p: PasskeyItem) {
    const next = window.prompt('Name this passkey', p.name);
    if (!next || !next.trim() || next.trim() === p.name) return;
    const r = await api(`passkey?id=${p.id}`, { method: 'PATCH', body: { name: next.trim() } });
    if (r.status === 401) return onExpired();
    if (!r.ok) setError(errorText(r, 'Could not rename the passkey.'));
    void load();
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    const r = await api(`passkey?id=${removing.id}`, { method: 'DELETE' });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (!r.ok) setError(errorText(r, 'Could not remove the passkey.'));
    else setNotice('Passkey removed.');
    const wasCurrent = removing.current;
    setRemoving(null);
    if (wasCurrent) return onExpired();
    void load();
  }

  return (
    <div className="mfa-card pk-card">
      <h2>Passkeys</h2>
      <p className="muted">Sign in with your fingerprint, face or device PIN instead of a password and a code. A passkey counts as both steps. Add one for each device you use.</p>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {notice && <p className="form-status form-status--ok" role="status">{notice}</p>}
      {!items && !error && <div className="admin-skeleton" role="status" aria-label="Loading"><span /></div>}
      {items && items.length === 0 && <p className="muted">No passkeys yet.</p>}
      {items && items.length > 0 && (
        <ul className="pk-list">
          {items.map((p) => (
            <li key={p.id} className="pk-item">
              <span className="pk-icon" aria-hidden="true">&#128273;</span>
              <span className="pk-text">
                <strong>{p.name}</strong>
                <span className="muted">
                  Added {when(p.created_at)} · {p.last_used_at ? `last used ${when(p.last_used_at)}` : 'not used yet'}
                </span>
              </span>
              {p.backed_up && <span className="badge">Synced</span>}
              {p.current && <span className="badge">This session</span>}
              <span className="pk-actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void rename(p)}>Rename</button>
                <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setRemoving(p)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {items && items.length < max && (
        passkeysSupported() ? (
          <div className="pk-add">
            <div className="field">
              <label htmlFor="pk-name">Name (so you can tell them apart)</label>
              <input id="pk-name" type="text" value={name} maxLength={60} placeholder="For example: work laptop, phone" onChange={(e) => setName(e.target.value)} />
            </div>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void add()}>
              {busy ? 'Waiting for your device…' : 'Add a passkey'}
            </button>
          </div>
        ) : (
          <p className="form-status form-status--info" role="status">This browser does not support passkeys.</p>
        )
      )}
      <ConfirmDialog open={removing !== null} title="Remove this passkey?" confirmLabel="Remove passkey" danger busy={busy} onConfirm={() => void remove()} onCancel={() => setRemoving(null)}>
        <p>
          {removing?.name} will no longer sign in to the admin.
          {removing?.current ? ' You are signed in with it right now, so you will be signed out.' : ''}
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** The Security tab: your own two-step status for everyone, plus the team list and resets for owners. */
export function TeamPanel({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [team, setTeam] = useState<{ items: TeamItem[]; mfaMode: string; mfaKnown: boolean; passkeysKnown: boolean } | null>(null);
  const [mine, setMine] = useState<{ enrolled: boolean; mfaAvailable: boolean } | null>(null);
  const [error, setError] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<PasskeyItem[]>([]);
  const [removingTheirs, setRemovingTheirs] = useState<PasskeyItem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await api<{ enrolled: boolean; mfaAvailable: boolean }>('session');
    if (s.status === 401) return onExpired();
    if (s.ok && s.data) setMine({ enrolled: s.data.enrolled, mfaAvailable: s.data.mfaAvailable });
    if (me.can('team.read')) {
      const t = await api<{ items: TeamItem[]; mfaMode: string; mfaKnown: boolean; passkeysKnown: boolean }>('team');
      if (t.status === 401) return onExpired();
      if (t.ok && t.data) setTeam(t.data);
      else setError(errorText(t, 'Could not load the team.'));
    }
  }, [me, onExpired]);
  useEffect(() => {
    void load();
  }, [load]);

  async function reset(t: TeamItem) {
    if (!window.confirm(`Reset two-step verification for ${t.email}? They will have to set it up again on their next sign-in.`)) return;
    const r = await api('team-mfa-reset', { method: 'POST', body: { email: t.email } });
    if (r.status === 401) return onExpired();
    if (!r.ok) setError(errorText(r, 'Could not reset.'));
    void load();
  }

  async function openPasskeys(t: TeamItem) {
    if (managing === t.email) return setManaging(null);
    const r = await api<{ items: PasskeyItem[] }>(`team-passkeys?email=${encodeURIComponent(t.email)}`);
    if (r.status === 401) return onExpired();
    if (!r.ok || !r.data) return setError(errorText(r, 'Could not load their passkeys.'));
    setError('');
    setTheirs(r.data.items);
    setManaging(t.email);
  }
  async function removeTheirs() {
    if (!removingTheirs || !managing) return;
    setBusy(true);
    const r = await api(`team-passkey?id=${removingTheirs.id}`, { method: 'DELETE' });
    setBusy(false);
    if (r.status === 401) return onExpired();
    if (!r.ok) setError(errorText(r, 'Could not remove the passkey.'));
    const email = managing;
    setRemovingTheirs(null);
    const again = await api<{ items: PasskeyItem[] }>(`team-passkeys?email=${encodeURIComponent(email)}`);
    if (again.ok && again.data) setTheirs(again.data.items);
    void load();
  }

  return (
    <section aria-labelledby="sec-title">
      <div className="admin-toolbar">
        <h1 id="sec-title">Security</h1>
      </div>
      <div className="mfa-card">
        <h2>Your sign-in</h2>
        <p>
          {me.email} · {ROLE_LABELS[me.role]} · Two-step verification: <strong>{mine ? (mine.enrolled ? 'on' : 'off') : '…'}</strong>
        </p>
        {mine && !mine.enrolled && mine.mfaAvailable && !enrolling && (
          <button type="button" className="btn btn--sm" onClick={() => setEnrolling(true)}>
            Set up two-step verification
          </button>
        )}
        {enrolling && (
          <EnrolFlow
            onDone={() => {
              setEnrolling(false);
              void load();
            }}
          />
        )}
      </div>
      <PasskeyCard onExpired={onExpired} />
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {team && (
        <>
          <h2 className="admin-subhead">Team</h2>
          <p className="field-hint">
            Roles come from ADMIN_ROLES in Vercel, so a change there applies on the next request. Two-step verification is {team.mfaMode === 'required' ? 'required for everyone' : 'optional'}.
            {!team.mfaKnown && ' (Could not read two-step status: has supabase/roles_mfa_audit.sql been run?)'}
            {!team.passkeysKnown && ' (Could not read passkeys: has supabase/admin_passkeys.sql been run?)'}
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Administrators</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Two-step</th>
                  <th scope="col">Passkeys</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {team.items.map((t) => (
                  <Fragment key={t.email}>
                    <tr>
                      <td>
                        {t.email}
                        {t.you && <span className="badge"> you</span>}
                      </td>
                      <td>{ROLE_LABELS[t.role]}</td>
                      <td>{t.mfaEnrolled ? 'On' : 'Not set up'}</td>
                      <td>{t.passkeyCount}</td>
                      <td>
                        {!t.you && t.mfaEnrolled && me.can('team.manage') && (
                          <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => void reset(t)}>
                            Reset two-step
                          </button>
                        )}
                        {!t.you && t.passkeyCount > 0 && me.can('team.manage') && (
                          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={managing === t.email} onClick={() => void openPasskeys(t)}>
                            {managing === t.email ? 'Hide passkeys' : 'Passkeys'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {managing === t.email && (
                      <tr>
                        <td colSpan={5}>
                          {theirs.length === 0 ? (
                            <p className="muted">No passkeys.</p>
                          ) : (
                            <ul className="pk-list">
                              {theirs.map((p) => (
                                <li key={p.id} className="pk-item">
                                  <span>{p.name}</span>
                                  {p.backed_up && <span className="badge">Synced</span>}
                                  <span className="pk-actions">
                                    <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setRemovingTheirs(p)}>
                                      Remove
                                    </button>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <ConfirmDialog open={removingTheirs !== null} title="Remove this passkey?" confirmLabel="Remove passkey" danger busy={busy} onConfirm={() => void removeTheirs()} onCancel={() => setRemovingTheirs(null)}>
            <p>
              {removingTheirs?.name} will no longer sign in as {managing}. Any session using it ends on its next request. They can still sign in with their password and code.
            </p>
          </ConfirmDialog>
        </>
      )}
    </section>
  );
}
