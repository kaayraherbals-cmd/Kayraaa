import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { firstName, useSession } from '../lib/session';
import { IconUser } from './Icons';

/** Header account control. Signed out: a plain link to sign in. Signed in: a small menu with the account, orders and sign out. */
export default function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (user === undefined) return <span className="tool tool--ghost" aria-hidden="true" />;

  if (!user) {
    return (
      <Link className="tool" to="/login" onClick={onNavigate} aria-label="Account: sign in or create an account">
        <IconUser />
        <span className="tool-label" aria-hidden="true">Account</span>
      </Link>
    );
  }

  const name = firstName(user);
  const close = () => {
    setOpen(false);
    onNavigate?.();
  };
  return (
    <div className="acct" ref={box}>
      <button ref={btn} type="button" className="tool" aria-haspopup="true" aria-expanded={open} aria-controls="acct-pop" onClick={() => setOpen((v) => !v)}>
        <IconUser />
        <span className="tool-label">{name}</span>
      </button>
      {open && (
        <div className="acct-pop" id="acct-pop">
          <p className="acct-mail">{user.email}</p>
          <Link to="/account" onClick={close}>Your account</Link>
          <Link to="/track-order" onClick={close}>Orders and tracking</Link>
          <Link to="/wishlist" onClick={close}>Wishlist</Link>
          {user.role === 'admin' && <Link to="/admin" onClick={close}>Admin panel</Link>}
          <button type="button" onClick={() => { setOpen(false); void signOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
