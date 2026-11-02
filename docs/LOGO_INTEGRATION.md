# Logo integration

Places now using the supplied logo: header (full logo; K icon only below 360px), mobile menu head, footer (replaces the outlined "Kaayra" text), loading screen (stacked), admin bar (K icon), favicons + apple-touch-icon (K mark on white), og-image 1200x630, og/twitter image alt text, Organization structured data (`logo` ImageObject + `image`, @id `/#logo`, size read from the file).
Spacing: header logo 2.1rem (mobile) / 2.75rem (desktop); footer logo max-width leaves room for the काशी label; no overlap measured at 320/390/1280.
Guards updated: seo:schema now requires the logo; the old "no logo" checks in seo.test.ts, brand.test.ts, seo-check.mjs were changed to "correct logo".
RAN: seo:schema 22/22; Chromium mock of header+footer at 320/390/1280. NOT RUN: npm ci, tsc, ESLint, Vitest, build, seo:check, real device.
