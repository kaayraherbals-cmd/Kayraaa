import { founders } from '../content/founders';
import EmailLink from './EmailLink';
import { IconInstagram } from './Icons';

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

/** Portrait width: one card per row on phones, three across from 48rem (inside a centred wrap). */
const PORTRAIT_SIZES = '(min-width: 48rem) 26rem, 90vw';

export default function FounderCards() {
  if (founders.length === 0) return null;
  return (
    <ul className="founder-grid">
      {founders.map((f) => (
        <li className="founder-card" key={f.name}>
          {f.photo && (
            <picture className="founder-portrait">
              {f.photo.webpSrcSet && <source type="image/webp" srcSet={f.photo.webpSrcSet} sizes={PORTRAIT_SIZES} />}
              <img className="founder-photo" src={f.photo.src} srcSet={f.photo.srcSet} sizes={PORTRAIT_SIZES} width={f.photo.width} height={f.photo.height} alt={f.photo.alt} loading="lazy" decoding="async" />
            </picture>
          )}
          <div className="founder-top">
            {!f.photo && <span className="founder-avatar" aria-hidden="true">{initials(f.name)}</span>}
            <div>
              <h3>{f.name}</h3>
              <p className="founder-role">{f.role}, Kaayra Herbals</p>
            </div>
          </div>
          {f.qualifications.length > 0 && (
            <ul className="founder-quals" aria-label={`Qualifications of ${f.name}`}>
              {f.qualifications.map((q) => <li key={q}>{q}</li>)}
            </ul>
          )}
          {f.bio && <p className="founder-bio">{f.bio}</p>}
          {(f.email || f.instagram) && (
            <div className="founder-links">
              {f.email && <EmailLink email={f.email} icon />}
              {f.instagram && (
                <a href={`https://www.instagram.com/${f.instagram}/`} target="_blank" rel="noopener noreferrer" aria-label={`${f.name} on Instagram, opens in a new tab`}>
                  <IconInstagram /><span>@{f.instagram}</span>
                </a>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
