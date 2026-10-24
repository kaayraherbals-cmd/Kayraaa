import { useEffect, useId, useState, type FormEvent } from 'react';
import { formatRupees } from '../../../shared/cart';
import { isValidPin } from '../../../shared/checkout';
import { IconPin } from '../Icons';

type Result =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; pin: string; ratePaise: number; freeAbovePaise: number | null }
  | { kind: 'no'; pin: string }
  | { kind: 'error'; message: string };

const KEY = 'kaayra.pin';

/** "Can you deliver to me?" Asks the server's serviceability table (/api/checkout/pincode). Needs no account. Shape is checked here for convenience only. */
export default function PinChecker() {
  const id = useId();
  const [pin, setPin] = useState('');
  const [r, setR] = useState<Result>({ kind: 'idle' });

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved && isValidPin(saved)) setPin(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  async function check(e: FormEvent) {
    e.preventDefault();
    const p = pin.trim();
    if (!isValidPin(p)) return setR({ kind: 'error', message: 'Enter a valid 6-digit PIN code.' });
    setR({ kind: 'checking' });
    try {
      const res = await fetch(`/api/checkout/pincode?pin=${encodeURIComponent(p)}`, { headers: { Accept: 'application/json' } });
      const data = (await res.json().catch(() => null)) as { serviceable?: boolean; ratePaise?: number | null; freeAbovePaise?: number | null; message?: string } | null;
      if (!res.ok || !data) return setR({ kind: 'error', message: data?.message ?? 'We could not check that right now. Please try again.' });
      try {
        window.localStorage.setItem(KEY, p);
      } catch {
        /* ignore */
      }
      setR(data.serviceable && typeof data.ratePaise === 'number' ? { kind: 'ok', pin: p, ratePaise: data.ratePaise, freeAbovePaise: data.freeAbovePaise ?? null } : { kind: 'no', pin: p });
    } catch {
      setR({ kind: 'error', message: 'Could not reach the server. Check your connection and try again.' });
    }
  }

  return (
    <form className="pin" onSubmit={(e) => void check(e)} noValidate>
      <label htmlFor={`${id}-pin`} className="pin-label"><IconPin /> Check delivery</label>
      <div className="pin-row">
        <input id={`${id}-pin`} type="text" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="PIN code" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); if (r.kind !== 'idle') setR({ kind: 'idle' }); }} aria-describedby={`${id}-out`} aria-invalid={r.kind === 'error' ? 'true' : undefined} />
        <button type="submit" className="btn btn--ghost" disabled={r.kind === 'checking'}>{r.kind === 'checking' ? 'Checking…' : 'Check'}</button>
      </div>
      <div id={`${id}-out`} className="pin-out" role="status" aria-live="polite">
        {r.kind === 'ok' && (
          <p data-tone="ok">
            We deliver to {r.pin}. {r.ratePaise === 0 ? 'Delivery is free.' : `Delivery is ${formatRupees(r.ratePaise)}.`}
            {r.freeAbovePaise !== null && r.ratePaise > 0 && ` Free delivery on orders of ${formatRupees(r.freeAbovePaise)} or more.`}
          </p>
        )}
        {r.kind === 'no' && <p data-tone="bad">We cannot deliver to {r.pin} yet.</p>}
        {r.kind === 'error' && <p data-tone="bad">{r.message}</p>}
      </div>
    </form>
  );
}
