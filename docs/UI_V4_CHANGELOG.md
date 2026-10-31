# UI v4 changelog

## Step 2: zero-visual-change token consolidation (2026-10-21, no network)
- src/styles/tokens.css: added --dur-1 (0.2s), --dur-2 (0.25s), --dur-3 (0.3s) next to the existing --dur (0.45s).
- 51 literal durations 0.2s / 0.25s / 0.3s in src/styles/*.css and src/admin.css now read those tokens (identical values, so no visual change expected).
- 14 literal `#fff` in the same files now read var(--white) (--white is #ffffff, identical).
- Deliberately NOT done: mapping near-duplicate off-palette colours (#faf8f3, #fffdf8, #4a4f45, #43483f ...) onto tokens, because that changes shades and must be compared in a browser first. Also not done: font swap, type scale, any component change.
- Checked: CSS brace balance per file (all balanced), no var() inside url(), TS syntax parse 220 files 0 errors.
- NOT run: lint, typecheck, tests, build, ui:check, screenshots (no network). Please run them before relying on this step.

## Step 3: admin typography clarity (2026-10-21, no network)
- src/admin.css: `.aprod-name` and `.stat-row strong` switched from the display serif to Manrope (--sans), same sizes and weights. Reason: admin brief asks for clarity over editorial decoration; a serif at weight 600/700 would also become faux bold if the display face changes to a single-weight font later.
- `.aprod-mono` (line ~301) still uses the display face; review in a browser.
- Not verified visually (no network, no build). Check the stat row and product list at 360px and 1440px.

## Step 4: display font changed to Fraunces (owner selected option A: Fraunces + Manrope) (2026-10-21, no network)
- Fonts: `--display` is now 'Fraunces Variable' (self-hosted via @fontsource-variable/fraunces, weight axis + italic). Manrope (body, UI, prices in admin) and Tiro Devanagari Hindi unchanged. Cormorant Garamond removed from package.json and src/main.tsx.
- package.json: removed @fontsource/cormorant-garamond, added @fontsource-variable/fraunces ^5.1.0.
- **package-lock.json was NOT updated (no network). Run `npm install` once to refresh it BEFORE `npm ci` or deploying; until then `npm ci` will fail on the mismatch.**
- main.tsx imports `@fontsource-variable/fraunces` and `@fontsource-variable/fraunces/wght-italic.css`. These import paths come from my knowledge of the package layout and were not checked against the installed package; if the build says a file is missing, look in node_modules/@fontsource-variable/fraunces for the italic css file name.
- Scale retuned because Fraunces is wider and heavier than Cormorant: --fs-h1 2.4rem..4.6rem (was 2.8..6), --fs-h2 2..3.3rem (was 2.3..4.2), --fs-h3 1.4..1.85rem, --fs-display 2.8..7rem (was 3.2..9.5). Heading letter-spacing eased (-0.02/-0.015/-0.005em, was -0.03/-0.025/-0.01) and line-heights opened slightly. Hero h1 and the outlined footer wordmark reduced the same way (footer: clamp(4rem, 18vw, 13rem)).
- Not changed: emails (shared/mailTemplates.ts keeps 'Cormorant Garamond',Georgia fallback; mail clients cannot load web fonts, so Georgia shows); comments in src/content/brand.ts, legacy.css, admin.css still say Cormorant.
- NOT verified: no install, build, lint, tests or browser render. Check: hero headline wrapping at 320-430px, footer wordmark width, product card titles, prices, italic accents (h1 em), cart rows.

## Step 5: every font replaced + Sanskrit line (owner request) (2026-10-21, no network)
- Body/UI font: Manrope -> **Instrument Sans Variable** (owner asked me to choose; chosen for readability at small sizes in forms/nav and a refined pairing with Fraunces). Weight range is 400-700; one rule asking for 800 will render at 700.
- Hindi/Sanskrit font: Tiro Devanagari Hindi -> **Noto Serif Devanagari Variable** (fallback keeps Tiro by name only if installed on the visitor's device).
- Headlines: Fraunces (Step 4). Cormorant, Manrope and Tiro are no longer bundled.
- package.json: removed @fontsource-variable/manrope and @fontsource/tiro-devanagari-hindi; added @fontsource-variable/instrument-sans and @fontsource-variable/noto-serif-devanagari. **package-lock.json still not regenerated: run `npm install` first.** The package names/versions are from memory and unchecked; if install fails on a name, check npmjs.com/@fontsource-variable.
- New in the footer (src/components/Layout.tsx, src/styles/layout.css): the Sanskrit line सर्वे भवन्तु सुखिनः with the English "Sarve bhavantu sukhinah: may all be happy." A general well-wishing line, not a health or product claim. **Owner: please have the Devanagari spelling and the translation confirmed by someone fluent in Sanskrit before launch.**
- Emails: shared/mailTemplates.ts still names Manrope / Cormorant (mail clients cannot load web fonts, so they fall back to system fonts); unchanged.
- NOT verified: no install, build, lint, tests or render. Check footer layout at 320-430px, Devanagari rendering, and text widths (Instrument Sans is narrower than Manrope).

## Step 6: homepage refinement (src/styles/home.css only) (2026-10-21, no network)
Content, sections, links and business rules in src/pages/Home.tsx are unchanged (no new claims, products or counts).
- Hero headline (desktop): clamp(3rem, 5.2vw, 4.9rem), was up to 6rem. Fraunces is wider than Cormorant; the longest line "Modern Thinking." is about 8em wide and must fit the 1.25fr hero column (about 48rem at 1440px).
- "Slow, on purpose." and "Rooted in Kashi." headlines: clamp(2.6rem, 7vw, 5.25rem / 5rem) with line-height 1, was up to 7.5rem / 7rem at 0.92.
- Small uppercase labels (hero eyebrow, assurance keys, hero stamp, ingredient part chips, journal meta): tracking reduced from 0.12-0.22em to 0.08-0.14em, weights 800/700 -> 700/600 (Instrument Sans tops out at 700), sizes nudged to 0.72-0.78rem.
- Ingredient and journal rows: hover/focus now moves the row with transform (translateX 0.6rem, --dur) instead of animating padding-left (which forced layout and broke the tokens rule "only opacity and transform"); keyboard focus-visible gets the same effect. Reduced-motion is covered by the global rule in base.css.
- text-wrap: pretty on the lede, philosophy paragraphs and status note.
- NOT verified: no build or render. Check at 320, 375, 390, 430, 768, 1024, 1440, 1920px: hero headline wrapping, the two large section headlines, row hover.
