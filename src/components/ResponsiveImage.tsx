import type { Photo } from '../content/images';

interface Props {
  photo: Photo;
  /** Value of the `sizes` attribute: how wide the image is shown at each viewport. */
  sizes: string;
  /** Hero or other above-the-fold image: loads eagerly. */
  priority?: boolean;
  className?: string;
}

/** Picture element with AVIF/WebP sources, srcSet, sizes, an optional mobile crop and explicit dimensions (no layout shift). */
export default function ResponsiveImage({ photo, sizes, priority, className }: Props) {
  const { mobile } = photo;
  return (
    <picture>
      {mobile?.sources?.map((s) => (
        <source key={`m-${s.type}`} media="(max-width: 39.99rem)" type={s.type} srcSet={s.srcSet} sizes="100vw" />
      ))}
      {mobile && <source media="(max-width: 39.99rem)" srcSet={mobile.srcSet ?? mobile.src} sizes="100vw" />}
      {photo.sources?.map((s) => (
        <source key={s.type} type={s.type} srcSet={s.srcSet} sizes={sizes} />
      ))}
      <img
        className={className}
        src={photo.src}
        srcSet={photo.srcSet}
        sizes={sizes}
        width={photo.width}
        height={photo.height}
        alt={photo.alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
      />
    </picture>
  );
}
