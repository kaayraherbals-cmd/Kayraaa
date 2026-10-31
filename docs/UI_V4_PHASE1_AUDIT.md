# UI v4, Phase 1: design-system and typography audit (2026-10-21)

Scope: read-only audit of src/styles/*.css, src/admin.css, src/main.tsx font imports. NO styles, components or fonts were changed in this phase.
Not run (no network, node_modules not installable): npm ci, lint, typecheck, tests, build, ui:check, screenshots. All figures below come from reading/grepping the source, not from a browser.

## Confirmed facts
- Files and sizes (lines): tokens 69, base 121, layout 106, home 107, shop 173, bag 125, account 69, pages 23, legacy 580, admin.css 362.
- Load order in src/main.tsx: tokens, legacy, base, layout, home, shop, bag, account, pages. Admin css is separate. legacy.css loads BEFORE base/layout, so any equal-specificity clash is resolved in favour of the newer files; ordering risk should be checked in a browser.
- Brand palette: all five brand hexes are defined once in tokens.css and appear nowhere else (0 raw uses). Good.
- Raw hex values still hard-coded outside tokens: admin.css 53, legacy.css 38, layout.css 5, base.css 4, home.css 1, shop.css 1, pages.css 2. Examples: #fff, #faf8f3, #b9c9b0, #4a4f45, #c79a2a (admin); #e4e0d3, #43483f, #d6b57f, #fffdf8 (legacy). These are off-palette near-duplicates of --cream, --muted, --gold-light, --line. Candidates to map onto tokens.
- Type tokens: display = Cormorant Garamond (weights loaded: 500, 500 italic, 600, 700), sans = Manrope Variable, deva = Tiro Devanagari Hindi.
- Display sizes: --fs-display up to 9.5rem, --fs-h1 up to 6rem, --fs-h2 up to 4.2rem. Footer wordmark starts at clamp(5.5rem...). These conflict with the new brief ("no oversized headings, esp. mobile"); sizes at 320-430px must be checked in a browser.
- The display serif is also used for functional text: prices (.pcard-price 600, .buy-price), cart totals (600), order numbers (600), and in admin (.aprod-name 700, .stat-row strong 600). Admin brief says clarity over decoration.
- Motion: only one --dur token (0.45s) and --ease. Literal durations in use: 0.25s x20, 0.3s x18, 0.2s x13, 0.4s x6, 0.9s x6, 0.45s x4, 0.35s x4, plus 0.5-0.8s. Reduced-motion handled (3 reduce blocks, 9 no-preference blocks).
- Breakpoints are literal rem values with no scale: 29.99, 34, 40, 48, 56, 60, 62, 64, 68, 79.99. Six or more distinct steps; 48rem and 56rem most used.
- Legacy aliases in tokens (--ivory, --brass, --charcoal, --paper, --hair ...) are still read by admin, auth, forms and journal rules.
- Tooling: ui:check script exists (scripts/ui-check.py, Playwright). A Chromium headless shell exists at /opt/pw-browsers, so browser checks are possible once dependencies can be built.

## Typography evaluation (Instrument Serif + Manrope vs current)
Reasoned from the CSS and the typefaces' known properties; NOT rendered side by side here, so it is a recommendation to confirm visually.
- Instrument Serif ships in a single regular weight plus italic. The current CSS asks the display face for 500/600/700 (prices, totals, order numbers, admin names). With Instrument Serif those would become synthetic bold. Prices, totals and all admin text should therefore move to Manrope (with tabular figures), and the serif be kept for headings, product titles and pull quotes at regular weight.
- It is Latin-only. Tiro Devanagari Hindi stays for Hindi, so a pairing check (x-height, baseline) is needed for the .deva marks in hero/footer.
- Cormorant Garamond at 500 is light and high-contrast at small sizes (product titles 1.5rem, cart item names). Instrument Serif is tighter and sturdier at those sizes but more condensed; decide after a rendered comparison of: hero h1, product card title, price, cart row, footer mark.
- Fonts are bundled via @fontsource (self-hosted); the replacement also needs the npm package (@fontsource/instrument-serif), which cannot be installed offline. Blocker: network.

## Suspected, not confirmed
- 7 classes in legacy.css have no literal reference in src (.ingredient-bot, .plist-media, .plist-row, .section--products, .section--sage, .section-head--products, .theme-womens). Crude grep: may be built dynamically. Do not delete before checking in the browser and in prerendered HTML.
- Duplicate or conflicting declarations between legacy.css and base/layout are likely but unproven.

## Proposed order for the next phases
1. On a networked machine: npm ci, lint, typecheck, test, build, ui:check to record a baseline and capture "before" screenshots.
2. Add type scale and spacing/duration/radius/shadow tokens; map the off-palette hexes to tokens.
3. Render the font comparison, decide, then swap fonts and move prices/admin to Manrope.
4. Header/hero/footer, then product and cart, then admin, verifying at 320-1920px.
