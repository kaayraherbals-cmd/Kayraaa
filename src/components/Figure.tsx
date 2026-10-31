import type { ReactNode } from 'react';
import type { Photo } from '../content/images';
import ResponsiveImage from './ResponsiveImage';

interface Props {
  photo: Photo | null;
  /** Shown when no photograph has been supplied. Decorative line illustration. */
  fallback: ReactNode;
  caption?: string;
  priority?: boolean;
  sizes?: string;
}

export default function Figure({ photo, fallback, caption, priority, sizes = '(min-width: 62rem) 40vw, 90vw' }: Props) {
  return (
    <figure className="fig-flush">
      <div className="art-frame">
        {photo ? (
          <ResponsiveImage photo={photo} sizes={sizes} priority={priority} />
        ) : (
          fallback
        )}
      </div>
      {caption && <figcaption className="art-caption">{caption}</figcaption>}
    </figure>
  );
}
