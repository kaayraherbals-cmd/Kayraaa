import type { ReactNode } from 'react';
import Botanical from './Botanical';

const POINTS = ['Passwords are hashed, never stored in plain text', 'Only your name and verified email', 'Delete your account any time'];

/** Split layout for sign-in and account pages: an animated botanical panel beside the form (panel hidden on small screens). */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-art" aria-label="About Kaayra">
        <p className="eyebrow">Rooted in Kashi</p>
        <div className="auth-art-figure" aria-hidden="true">
          <Botanical variant="b" draw />
        </div>
        <div>
          <p className="auth-quote">Ancient Wisdom. Modern Thinking. Better Living.</p>
          <ul className="auth-points">
            {POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="auth-main">{children}</div>
    </div>
  );
}
