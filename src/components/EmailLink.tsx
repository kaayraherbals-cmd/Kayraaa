import { useState } from 'react';
import { IconMail } from './Icons';

/**
 * Keeps an address out of the page's HTML so scrapers that read the markup do not find it. The prerendered page shows a
 * button; the address is only put on the page when a visitor asks for it. (It is still in the JavaScript bundle, so this
 * lowers spam exposure but is not secret. For anything private use the contact form.)
 */
export default function EmailLink({ email, icon = false }: { email: string; icon?: boolean }) {
  const [shown, setShown] = useState(false);
  if (shown) {
    return (
      <a href={`mailto:${email}`}>
        {icon && <IconMail />}
        <span>{email}</span>
      </a>
    );
  }
  return (
    <>
      <button type="button" className="email-reveal" onClick={() => setShown(true)}>
        {icon && <IconMail />}
        <span>Show email address</span>
      </button>
      <noscript>
        <a href="/contact">Use the contact form</a>
      </noscript>
    </>
  );
}
