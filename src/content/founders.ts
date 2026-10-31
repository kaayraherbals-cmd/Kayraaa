import list from '../../shared/founders.json';

export interface Founder {
  name: string;
  role: string;
  /** Only verified qualifications, one per entry. */
  qualifications: string[];
  /** University or college the qualifications above were earned at, as the founder supplied it. Card only: never in structured data or AI files. */
  institution?: string;
  /** Professional headline lines, as the founder supplied them (shown on the card only; never in structured data or AI files). */
  headline?: string[];
  email?: string;
  /** Instagram username without the @. */
  instagram?: string;
  bio?: string;
  /** Professional profile pages the founder supplied (for example LinkedIn), as full https URLs. Leave out until supplied. */
  profiles?: { label: string; url: string }[];
  /** Shown on the card when a founder has no professional profile to link, so the gap is explained rather than left blank. */
  profileNote?: string;
  photo?: { src: string; srcSet?: string; webpSrcSet?: string; width: number; height: number; alt: string };
}

/**
 * The names, roles, qualifications and Instagram handles live in shared/founders.json so the website and the
 * build-time structured data (scripts/prerender.mjs) read one source. Add `photo` or `bio` to an entry in that
 * file's TypeScript view below when they are ready; do not add anything that has not been confirmed.
 */
export const founders: Founder[] = list as Founder[];
