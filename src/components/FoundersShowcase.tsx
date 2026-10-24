import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { founders } from '../content/founders';
import { IconInstagram } from './Icons';

/**
 * "Meet our founders": the founder and CEO stands in the middle, the two co-founders either side.
 * Names, roles, qualifications and handles come from shared/founders.json (one source, nothing new is claimed).
 * Portraits are crops of the team photograph in public/images/founders/team-*.
 */
const PORTRAIT_SIZES = '(min-width: 48rem) 28rem, 80vw';

function portraitFor(name: string) {
  const key = name.split(/\s+/)[0].toLowerCase();
  const base = `/images/founders/team-${key}`;
  return {
    jpg: `${base}-480.jpg 480w, ${base}-800.jpg 800w`,
    webp: `${base}-480.webp 480w, ${base}-800.webp 800w`,
    src: `${base}-800.jpg`,
  };
}

/** Seat on the stage: the CEO in the middle, co-founders left and right in file order. */
function seat(role: string, coIndex: number) {
  if (/ceo/i.test(role)) return 'centre';
  return coIndex === 0 ? 'left' : 'right';
}

export default function FoundersShowcase() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add('in');
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (founders.length === 0) return null;

  // CEO first in the document (reading order), placed in the middle on wide screens by CSS.
  const ordered = [...founders].sort((a, b) => Number(/ceo/i.test(b.role)) - Number(/ceo/i.test(a.role)));
  let co = 0;

  return (
    <section ref={ref} className="section section--midnight on-dark fx" id="founders" tabIndex={-1} aria-labelledby="fx-title">
      <div className="wrap">
        <div className="fx-head">
          <div>
            <p className="eyebrow">The people</p>
            <h2 id="fx-title">Meet our <em>founders.</em></h2>
          </div>
          <p className="lede">The team behind Kaayra Herbals, a new Ayurvedic wellness company in Varanasi.</p>
        </div>

        <ul className="fx-stage">
          {ordered.map((f) => {
            const where = seat(f.role, /ceo/i.test(f.role) ? 0 : co++);
            const p = portraitFor(f.name);
            return (
              <li key={f.name} className={`fx-person fx-person--${where}`}>
                <div className="fx-arch">
                  <picture className="fx-frame">
                    <source type="image/webp" srcSet={p.webp} sizes={PORTRAIT_SIZES} />
                    <img src={p.src} srcSet={p.jpg} sizes={PORTRAIT_SIZES} width={800} height={1000} alt={`${f.name}, ${f.role} of Kaayra Herbals`} loading="lazy" decoding="async" />
                  </picture>
                </div>
                <div className="fx-caption">
                  <h3>{f.name}</h3>
                  <p className="fx-role">{f.role}</p>
                  {f.qualifications.length > 0 && (
                    <ul className="fx-quals" aria-label={`Qualifications of ${f.name}`}>
                      {f.qualifications.map((q) => <li key={q}>{q}</li>)}
                    </ul>
                  )}
                  {f.instagram && (
                    <a className="fx-ig" href={`https://www.instagram.com/${f.instagram}/`} target="_blank" rel="noopener noreferrer" aria-label={`${f.name} on Instagram, opens in a new tab`}>
                      <IconInstagram /><span>@{f.instagram}</span>
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="fx-more"><Link className="link-arrow" to="/founders">Read about the founders</Link></p>
      </div>
    </section>
  );
}
