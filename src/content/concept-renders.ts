import type { PublicProduct } from '../../shared/products';
import { productTheme } from './themes';

/**
 * TEMPORARY. Supplied concept packaging renders, used only where a product has no approved photograph.
 * They are tagged "Concept render" on the page. Set to false to remove them everywhere in one change.
 */
export const SHOW_CONCEPT_RENDERS = true;

export const CONCEPT_PATH = '/images/concept/';

const img = (file: string, name: string) => ({ src: `${CONCEPT_PATH}${file}`, alt: `Concept packaging render for ${name}. Not a final product photograph.` });

/** Approved photographs always win. Capsules have no render yet, so they keep the illustration. */
export function withConceptImages<T extends PublicProduct>(p: T): T {
  if (!SHOW_CONCEPT_RENDERS || p.image || (p.images && p.images.length > 0)) return p;
  if (/capsule/i.test(p.form)) return p;
  const images =
    productTheme(p.slug) === 'womens'
      ? [img('womens-ivory.webp', p.name), img('womens-burgundy.webp', p.name), img('womens-trio.webp', p.name)]
      : [img('syrup-green.webp', p.name)];
  return { ...p, image: images[0], images };
}
