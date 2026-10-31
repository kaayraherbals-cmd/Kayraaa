# Favicon audit

Findings: SVG, 48px PNG, 192px PNG and apple-touch icon already existed and were linked in `index.html`, all rendered from the K monogram in `public/favicon.svg`. No `/favicon.ico` existed, so the default root request returned 404. Canonical, WebSite JSON-LD (single node, name, alternateName Kaayra, url) and robots.txt (no block on favicons) were already correct and were left unchanged. `vercel.json` has no rewrite that catches favicon paths.

Change: added `public/favicon.ico` (16, 32, 48 px, transparent corners) and its `<link>`; extended `scripts/seo-check.mjs`.

Not done in the sandbox: build, tests, live URL checks. Brand note: no final approved logo artwork has been supplied (`public/brand/README.md`); the favicon reuses the existing K monogram.

## Update: official logo supplied

The owner supplied the official K logo (transparent PNG). It is stored as `public/brand/kaayra-k-logo-source.png`. `favicon.ico` (16/32/48), `favicon-48x48.png`, `favicon-96x96.png`, `favicon-192x192.png` (transparent) and `apple-touch-icon.png` (180, white background, iOS has no transparency) were regenerated from it, cropped to the artwork and centred on a square canvas. The old stand-in `favicon.svg` was removed and unlinked so that Google cannot pick the old monogram.
