import { useId, useState } from 'react';

/**
 * A founder's professional headline, hidden until the visitor asks for it, like the email address on the same card.
 * The text stays in the page HTML (only the `hidden` attribute changes), so it is still readable without JavaScript
 * by crawlers and assistive technology that ignore `hidden`; sighted visitors see a button first.
 */
export default function FounderHeadline({ lines, name }: { lines: string[]; name: string }) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="founder-headline">
      <button type="button" className="email-reveal founder-reveal" aria-expanded={shown} aria-controls={id} onClick={() => setShown((v) => !v)}>
        <span>{shown ? 'Hide professional background' : 'Show professional background'}</span>
      </button>
      <div id={id} hidden={!shown} aria-label={`Professional background of ${name}`}>
        {lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  );
}
