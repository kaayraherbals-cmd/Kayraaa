import { useState } from 'react';
import { INSTAGRAM_EMBED_URL, INSTAGRAM_HANDLE, site } from '../config/site';
import { IconInstagram } from './Icons';

/**
 * Instagram preview card. The card itself is ours (no request to Instagram). Instagram's own embed, which shows the latest
 * posts, loads only after the visitor taps the button, because Instagram may set cookies and this site promises none by default.
 */
export default function InstagramPreview() {
  const [live, setLive] = useState(false);
  if (!site.instagram) return null;
  return (
    <div className="wrap ig-preview">
      <div className="ig-card">
        <div className="ig-head">
          <img className="ig-avatar" src="/favicon-192x192.png" width={64} height={64} alt="Kaayra Herbals logo" />
          <div className="ig-id">
            <strong>{INSTAGRAM_HANDLE}</strong>
            <span>Kaayra Herbals on Instagram</span>
          </div>
          <a className="btn btn--ghost ig-follow" href={site.instagram} target="_blank" rel="noopener noreferrer" aria-label={`Follow ${INSTAGRAM_HANDLE} on Instagram (opens in a new tab)`}>
            <IconInstagram /> Follow
          </a>
        </div>
        {live ? (
          <iframe
            className="ig-frame"
            src={INSTAGRAM_EMBED_URL}
            title={`Latest posts from ${INSTAGRAM_HANDLE} on Instagram`}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="ig-gate">
            <p className="muted">See our latest posts here. Nothing is requested from Instagram until you tap.</p>
            <button type="button" className="btn" onClick={() => setLive(true)}>Show latest posts</button>
          </div>
        )}
      </div>
    </div>
  );
}
