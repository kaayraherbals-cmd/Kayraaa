/**
 * Photography slots. No licensed or owned photography has been supplied yet, so every slot is null
 * and pages fall back to a botanical line illustration (labelled as an illustration).
 *
 * To add a photo: place the files in /public/images, then set the slot, e.g.
 *   hero: { src: '/images/hero-1200.jpg', srcSet: '/images/hero-800.jpg 800w, /images/hero-1200.jpg 1200w',
 *           width: 1200, height: 1500, alt: 'Describe what is actually in the photograph' }
 * Only use photographs Kaayra owns or has licensed. Do not use photographs that imply a finished product.
 */
/** An alternative encoding of the same image (AVIF or WebP). The browser picks the first type it supports. */
export interface PhotoSource {
  type: 'image/avif' | 'image/webp';
  srcSet: string;
}

/** A crop made for narrow screens (art direction), used below 40rem. */
export interface PhotoMobile {
  src: string;
  srcSet?: string;
  width: number;
  height: number;
  sources?: PhotoSource[];
}

export interface Photo {
  /** JPEG or PNG fallback, always required. */
  src: string;
  srcSet?: string;
  /** AVIF / WebP versions, listed best-first. */
  sources?: PhotoSource[];
  width: number;
  height: number;
  /** Describe what is actually in the photograph. Use alt: '' only for purely decorative images. */
  alt: string;
  mobile?: PhotoMobile;
}

export const photos: Record<'hero' | 'story' | 'macro' | 'kashi' | 'development', Photo | null> = {
  /** Desktop hero. Add `mobile` for a separate mobile crop. */
  hero: null,
  story: null,
  /** Full-width botanical macro for the "Nature meets science" band. */
  macro: null,
  kashi: null,
  /** Product-development imagery (process, lab or ingredient work). Never a render presented as finished inventory. */
  development: null,
};

/** Approved Instagram photographs for the community grid (3 or 4). The grid is hidden while this is empty. */
export const instagramPhotos: Photo[] = [];
