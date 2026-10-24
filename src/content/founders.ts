import list from '../../shared/founders.json';

export interface Founder {
  name: string;
  role: string;
  /** Only verified qualifications, one per entry. */
  qualifications: string[];
  email?: string;
  /** Instagram username without the @. */
  instagram?: string;
  bio?: string;
  photo?: { src: string; srcSet?: string; webpSrcSet?: string; width: number; height: number; alt: string };
}

/**
 * The names, roles, qualifications and Instagram handles live in shared/founders.json so the website and the
 * build-time structured data (scripts/prerender.mjs) read one source. Add `photo` or `bio` to an entry in that
 * file's TypeScript view below when they are ready; do not add anything that has not been confirmed.
 */
export const founders: Founder[] = list as Founder[];
