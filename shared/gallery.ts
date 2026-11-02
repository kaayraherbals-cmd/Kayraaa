import { IMAGE_PATH_RE, claimProblems } from './products.js';

/** Several photos per product. The first photo is the primary one and is mirrored onto the product (public_image) for cards and previews. */
export const MAX_GALLERY_IMAGES = 8;

export interface GalleryImage {
  path: string;
  alt: string;
}

export function validateGallery(raw: unknown): { ok: true; images: GalleryImage[] } | { ok: false; errors: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['Send a JSON object.'] };
  const list = (raw as Record<string, unknown>).images;
  if (!Array.isArray(list)) return { ok: false, errors: ['Send the list of images.'] };
  if (list.length > MAX_GALLERY_IMAGES) return { ok: false, errors: [`A product can have at most ${MAX_GALLERY_IMAGES} photos.`] };
  const errors: string[] = [];
  const images: GalleryImage[] = [];
  const seen = new Set<string>();
  list.forEach((item, i) => {
    const n = i + 1;
    const o = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const path = typeof o.path === 'string' ? o.path : '';
    const alt = typeof o.alt === 'string' ? o.alt.trim() : '';
    if (!IMAGE_PATH_RE.test(path)) return void errors.push(`Photo ${n} is not an uploaded image.`);
    if (seen.has(path)) return void errors.push(`Photo ${n} is a duplicate.`);
    if (alt.length < 3 || alt.length > 200) return void errors.push(`Photo ${n} needs a description of 3 to 200 characters (it is read aloud by screen readers).`);
    for (const why of claimProblems(alt)) errors.push(`The description of photo ${n} cannot be used: ${why}.`);
    seen.add(path);
    images.push({ path, alt });
  });
  return errors.length ? { ok: false, errors } : { ok: true, images };
}

/** Files that were in the old list and are gone from the new one, so their stored bytes can be deleted. */
export const removedPaths = (before: string[], after: GalleryImage[]): string[] => {
  const keep = new Set(after.map((i) => i.path));
  return before.filter((p) => !keep.has(p));
};
