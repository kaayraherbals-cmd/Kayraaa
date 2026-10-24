# SEO audit follow-up (report.pdf, kaayraherbals.com, grade B, 21 recommendations)

## Fixed in code
| Report item | What changed |
|---|---|
| Improve heading structure (first heading was H2) | The hidden cart drawer ("Your bag" H2) sat before `<main>`. `CartDrawer` now renders after `<main>`; the H1 is the first heading. |
| Remove clear-text email addresses | New `EmailLink`: the address is not in the HTML; a "Show email address" button reveals it. Used for founders, footer, Contact, Privacy. Limit: the address is still inside the JS bundle. |
| Remove inline styles | All `style=` attributes on public pages replaced with classes (`pages.css` end). 26 on the homepage before, 0 after. Admin/reviews screens untouched. |
| Defer render-blocking resources | `boot.js` is inlined (allowed in CSP by SHA-256 hash; build stops if it changes without updating `vercel.json`). Two latin font files preloaded. The single stylesheet is still render-blocking on purpose (prerendered pages would flash unstyled). |
| Implement llms.txt | `public/llms.txt` (site address filled in at build). |
| Add FAQ / Q&A content | `shared/faq.json` → visible section on Home + FAQPage JSON-LD. **Update the "Is anything for sale yet?" answer when selling starts.** |
| Hreflang | `en-IN` and `x-default` self-references on indexable pages. |
| Keywords across tags | "herbal" added to the homepage meta description (title unchanged). |
| Facebook/X/LinkedIn/YouTube links | Supported through `VITE_FACEBOOK_URL`, `VITE_X_URL`, `VITE_LINKEDIN_URL`, `VITE_YOUTUBE_URL`; nothing is linked until set. |
| Analytics | Optional cookie-less Vercel Web Analytics via `VITE_VERCEL_ANALYTICS=true` (enable it in the Vercel project first). |
| Thin content | FAQ adds about 250 words of real content. |

## Needs you (cannot be done in code)
1. **Avoid multiple page redirects (0.63 s on mobile).** In Vercel > Domains make ONE domain primary (apex `kaayraherbals.com`), redirect `www` to it with a single 308, and use the same address in `VITE_SITE_URL`.
2. **SPF and DMARC (DNS).** Follow your mail provider's instructions for SPF (Resend gives records for its sending domain). Then add a DMARC record at `_dmarc.kaayraherbals.com`, TXT: `v=DMARC1; p=none; rua=mailto:<an inbox you read>` and tighten to `quarantine` after a few weeks of clean reports. Do not paste an SPF record from elsewhere: two SPF records break mail.
3. **Social profiles.** Create them, then set the four `VITE_*_URL` variables.
4. **Google Business Profile, local business schema, phone/address.** Only worth it when there is a real public address or service area and phone. Set `VITE_CONTACT_PHONE` / `VITE_CONTACT_ADDRESS`; local schema is intentionally not emitted for a pre-launch company with no public premises.
5. **Link building (the one High priority item).** 0 backlinks. Realistic steps: Instagram bio link, founder profiles, listings in genuine Varanasi/Ayurveda directories, guest articles, press for the incorporation, sharing journal articles. Avoid bought links.
6. **Facebook Pixel.** Not installed: no ads, and it needs a consent banner. Add with Meta ads.
7. **Google Search Console.** Add the domain and submit `/sitemap.xml`.

## Verified here
`npm ci`, `tsc`, `eslint`, 1040 vitest tests, production build and `npm run seo:check` pass. Chromium (390px, real CSP from `vercel.json`): boot script ran, first heading H1, 0 inline styles, no addresses in DOM until revealed, reveal works, FAQ renders, no CSP errors. NOT run: PageSpeed/the audit tool on the deployed site, DNS, Supabase.

## Merge note
Merged with the favicon/logo update and the mobile menu + founder roles change. The mobile menu link stagger no longer uses an inline `style` (it would have reintroduced inline styles on every page); delays are `nth-child` rules in `layout.css`. `favicon.svg` is removed (official logo PNG/ICO set replaces it); `seo-check.mjs` checks the new icon files. Merged files were not built or tested here (no node_modules): run `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run seo:check`.
