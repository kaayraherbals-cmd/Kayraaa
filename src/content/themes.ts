/**
 * Per-product colour themes. A theme only recolours the page; it adds no claims, images or text.
 * Women's line palette is PROPOSED (see design/packaging/README.md) and needs brand approval.
 * To theme another product, add its slug here. Slugs are from the product catalogue.
 */
export type ProductTheme = 'womens';

const THEMES: Record<string, ProductTheme> = {
  'pcos-syrup': 'womens',
  'pcos-cap': 'womens',
  'leucorrhoea-syp': 'womens',
};

export const productThemeClass = (slug: string): string => (THEMES[slug] ? `theme-${THEMES[slug]}` : '');

export const productTheme = (slug: string): ProductTheme | null => THEMES[slug] ?? null;
