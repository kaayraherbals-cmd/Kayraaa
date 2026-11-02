import { useEffect, useState } from 'react';

/**
 * Keeps an overlay mounted for `ms` after `open` turns false, so its exit animation can play before it is hidden.
 * Returns true while the overlay should be in the DOM. Under reduced motion it hides at once (no delay).
 */
export function usePresence(open: boolean, ms = 280): boolean {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPresent(false);
      return;
    }
    const t = window.setTimeout(() => setPresent(false), ms);
    return () => window.clearTimeout(t);
  }, [open, ms]);
  return open || present;
}
