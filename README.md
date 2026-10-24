# Kaayra Herbals: pre-launch website

Vite + React + TypeScript, statically prerendered, with Vercel serverless functions for the launch list, contact form and an admin-only panel. No checkout, no products for sale, no simulated consultations.

Brand: **Ancient Wisdom. Modern Thinking. Better Living.** Rooted in Kashi. Palette and fonts follow the supplied strategy (Deep Herbal Green #173A2D, Warm Ivory #F7F5EF, Botanical Sage #A9BBA6, Soft Sand #E8DFD0, Muted Bronze #A88452, Charcoal #252B27; Cormorant Garamond and Manrope).

## Status of this build (read first)

Written, but **not built or run end to end**. `npm install` was blocked in the build environment (registry access denied by network policy), so ESLint, Vitest, `vite build`, the prerender step and browser checks (mobile layout, keyboard, accessibility, Lighthouse) have **not** been run, and nothing is deployed.

What was actually verified, offline:

- Unit tests for the validators, CSV/search helpers and admin session tokens: 15 tests, all passing (run through a compiled copy with a minimal test shim, not Vitest itself).
- The admin API (`api/admin/[action].ts`) exercised against a mocked Supabase: 21 authorisation checks, all passing (listed under Admin below).
- TypeScript pass over the whole project. With React, Vite and router types unavailable, errors from missing dependencies were filtered out; no other errors remained. Treat this as partial.

Run on your machine first, then fix anything reported:

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run build
```

## Deploy (Vercel)

**Follow `docs/VERCEL_SETUP.md` for the full step-by-step, including the sign-in and sign-up setup.** This project targets Vercel only (serverless `/api`); it will not work on Netlify as is.

Push to Git and import into Vercel (framework preset: Vite). Set the variables from `.env.example` in Project Settings > Environment Variables, then redeploy.

## Backend setup (required for forms and admin)

1. Create a Supabase project. Run `supabase/launch_subscribers.sql`, then `supabase/email_outbox.sql`, then `supabase/launch_optin.sql` (double opt-in and unsubscribe) in the SQL editor. It creates `launch_subscribers`, `contact_messages` and `admin_audit`, all with RLS on and no public policies. Then run `supabase/issues.sql` for problem reports (same rules).
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` in Vercel (server only, never `VITE_`-prefixed).
3. Until these are set, both public forms say they are not open yet and save nothing.

The public endpoints (`/api/subscribe`, `/api/contact`) validate input, require explicit consent, treat repeat launch-list emails as "already subscribed", ignore honeypot submissions, check the request origin and rate-limit per instance. One confirmation email is sent to a new launch-list address when `RESEND_API_KEY` is set (see `docs/EMAIL_SETUP.md`); add double opt-in and an unsubscribe link before any campaign.

## Admin panel (`/admin`, admins only)

Opens on an **Overview** of what needs attention. Manages the launch list, **members** (site accounts), contact messages, problem reports, products (with several photos and pack-size variants), **inventory by batch and expiry**, **orders**, **refunds and returns** (a record; an approved refund can be paid back through Razorpay, see `docs/RAZORPAY_SETUP.md`), and, for owners, the **audit log** and **team and security** page. Every action is audited in `admin_audit` (append-only). Access has three layers after the allowlist: **two-step verification** (authenticator app, once per session), a **role** (owner, manager, support, from `ADMIN_ROLES`) checked per action, and the audit entry. See `docs/CHANGES_PHASE3.md` for the permission table and the upgrade steps.

Setup (password login; OAuth is described in the next section):

1. In Supabase: Authentication > Users > Add user. Create each admin with an email and strong password, auto-confirmed. Then in Authentication settings **turn off "Allow new users to sign up"**.
2. In Vercel set `ADMIN_EMAILS` (comma-separated, the only addresses allowed in), `ADMIN_SESSION_SECRET` (`openssl rand -base64 48`) and `ADMIN_MFA_KEY` (`openssl rand -base64 32`). Also `ADMIN_ROLES` (`email:role,...`, required: with it unset nobody can sign in to the admin).
3. Redeploy and sign in at `/admin`.

How access is controlled:

- Authorisation is an **allowlist** (`ADMIN_EMAILS`), checked on every request. A valid Supabase account that is not on the list gets the same generic error as a wrong password and no session.
- Sessions are HMAC-signed, HttpOnly, SameSite=Strict (Secure in production) cookies that expire after 8 hours. Removing an email from the allowlist or rotating the secret ends sessions immediately.
- State-changing requests need a same-origin `Origin` plus a custom header (CSRF defence on top of SameSite).
- Login is rate-limited per IP and per email (best effort, per server instance). Add a Vercel Firewall rate-limit rule on `/api/admin/login` for real protection.
- If any admin variable is missing, the API fails closed (503) and the panel shows a setup notice.
- `/admin` is noindex, excluded from the sitemap and disallowed in robots.txt, and `/api/*` responses are `no-store`.
- Security headers include a strict Content-Security-Policy (no inline scripts), HSTS and frame denial.

Offline checks that passed: no cookie, forged cookie, cross-origin login, missing CSRF header, non-allowlisted valid user, wrong password (identical message), allowlisted login, cookie flags, session, list, search-injection stripping, invalid ids, delete, CSV formula neutralisation, allowlist revocation, secret rotation, fail-closed when unconfigured, and login rate limiting.

Not done: two-factor authentication. Enable MFA/hardening on the Supabase side and keep the admin list short. Moving admin to a separate domain or adding SSO would be stronger still.

## Sign in and sign up (`/login`, `/signup`, `/forgot-password`, `/set-password`, `/account`)

Two ways in, both through Supabase Auth, run **server-side** in `api/auth/[action].ts` (HttpOnly cookies, CSRF header, per-IP and per-email rate limits):

- **Email and password.** Sign up asks for name, email, password and confirm password. We send a verification link (PKCE); the person must verify before the first sign-in. Passwords are stored by Supabase as hashes; this site never stores or logs them.
- **Google** (GitHub and Microsoft optional via `OAUTH_PROVIDERS`). After the first Google sign-in the person is asked for their **name** and to **choose and confirm a password** (`/set-password`), which they can use for manual sign-in later. Returning Google users who already have a password go straight in.
- **Forgot password.** `/forgot-password` emails a one-hour link (same answer whether or not the email exists), then `/set-password` takes the new password and confirmation.

Password rules (server/password.ts, also shown in the form): 8 to 72 bytes, at least one letter and one number, not a very common password, not the email address.

Access rule (`decideAccess` in `server/oauth.ts`): the email must be verified; addresses in `ADMIN_EMAILS` are admins; everyone else is a member; `MEMBER_SIGNUP=closed` stops new members but lets existing ones in. There is no longer an "admin must sign in first" step. Admin rights come only from `ADMIN_EMAILS`.

Setup is in `docs/VERCEL_SETUP.md` (Supabase SQL, Google provider, **Confirm email on, custom SMTP**, redirect URLs, env vars). Run `supabase/auth_members.sql` again if you installed an earlier version: it adds the `has_password` column.

Sessions: admins 8 hours, members 7 days. `/account` lets a member sign out or delete their account (removes the `members` row and the Supabase auth user). Not built: changing a password while signed in (use Forgot password). Members are listed in the admin Members tab.

Checked offline: `server/oauth.test.ts`, `server/password.test.ts`, and an end-to-end run of the handler against a mocked Supabase (sign-up, verification link, same-browser and other-browser links, wrong and unverified login, Google first sign-in then name and password, returning Google, forgot and reset, CSRF, admin password login). Not run: the real Google/Supabase round trip, the React pages in a browser, `npm run build`.

## Error codes and problem reports

- **Error codes.** Every visible error has a code like `KH-AUTH-001` and a one-off reference like `R-7K2M9QXA`. Full list: `docs/ERROR_CODES.md`. Server faults are logged with their reference, so a visitor's reference finds the exact log line in Vercel.
- **Report a problem.** `/report-a-problem` (linked from every error box and the footer) saves a report to the `issues` table: category, summary, details, the error code and reference, the page path (no query string), browser type, and an email only if the visitor gives one and agrees. It is rate limited and has a honeypot.
- **Admin > Issues.** Filter by status, search by summary, error code or reference, set status (open, investigating, resolved, closed) and severity, keep internal notes, reply by email, delete. Changes are audited.

## Phase 2: brand, collection and product records

**Products are server-side.** The eight proposed formulations (Liver DS + Xzyme Syp, Piles Syrup, Piles Cap, Leucorrhoea Syp, PCOS Syrup, PCOS Cap, Iron Syrup, Multi-Vitamin Syrup) are stored in the database exactly as supplied, all as `DRAFT`. Their ingredient data is **not** in the front-end bundle, static JSON, metadata or any public API. The public site reads `/api/products`, which reads only the `public_products` database view: approved statuses only, and the ingredient list only when composition and preservatives are verified and an admin has switched ingredients on.

Setup (after the earlier SQL files):

1. Run `supabase/products.sql`, then `supabase/products_seed.sql` in the Supabase SQL editor.
2. Sign in at `/admin` and open the **Products** tab. Each product shows what it still needs before it can be previewed.
3. Put approved product images in `public/images/products/` (self-hosted only; the CSP allows same-origin images) and enter the path and alt text in the admin.

Until a product is approved for preview, `/collection` and the homepage show an honest pre-launch state, and the hero keeps "Explore Our Approach". "Explore Our Collection" appears automatically once at least one preview exists.

Rules the code enforces (`shared/products.ts`, mirrored in the database): text containing "AYUSH approved", "government approved", "clinically proven", "GMP certified", cure/treat/prevent or guarantee claims is rejected; a preview needs a public name, an approved description, a named reviewer and the claims-reviewed box; ingredients need verified composition and preservatives (Iron Syrup and Multi-Vitamin Syrup have none supplied); **APPROVED_FOR_SALE cannot be set** and commerce is off (`shared/commerce.ts`). Hiding a product is always allowed.

Other Phase 2 pieces: product detail template (`/collection/:slug`, rendered from the API, noindex until a real product loads), Medical Disclaimer page, development status page (replaces the old two-product page), homepage reordered to the requested sequence, About page with the incorporation milestone, footer with company details (legal name, incorporation date, registered location, CIN, Instagram; PAN and TAN are never shown), Organization structured data, packaging templates in `design/packaging/`, and the documents in `docs/`: `REGULATORY_PUBLICATION_CHECKLIST.md`, `ECOMMERCE_ARCHITECTURE.md`, `TESTING_REPORT.md`, `CHANGES_PHASE2.md`.

## What changed in this revision

- Palette, fonts, tagline and hero copy updated to the supplied strategy; navigation is Home, Our Story, How We Work, Ingredients, Journal, Contact plus a **Join the launch list** button.
- Homepage restructured into nine sections: hero, philosophy, three pillars, products in development, nature meets science, ingredient library, roots in Kashi, journal and Instagram, launch community.
- New pages: Ingredients (searchable), Quality and Transparency; Contact now has a working form.
- Products in development are now the two named in the strategy (I-Care Syrup; Liv Mitra / Liv Shield Syrup) with an "In Development" label only. The earlier Leuco Shots and churna concepts were removed.
- Mobile menu drawer, header shadow on scroll and a short page transition added; all respect reduced motion.

## Needs the owner before launch

- **Contact details and legal entity name**: set `VITE_CONTACT_*` and `VITE_LEGAL_ENTITY_NAME`. Fields stay hidden while blank; the Privacy Policy's withdrawal route depends on an email being set.
- **Founders** (`src/content/founders.ts`): empty, so no founder block is shown. Add names, roles, verified qualifications and real photographs. Nothing was invented.
- **Story, mission and vision text** (`src/pages/Story.tsx`, Kashi line on the homepage): drafted from the strategy document. Confirm every statement, including the description of Kashi.
- **Logo**: no logo artwork was supplied, so the header and footer use a text wordmark and the favicon is a simple K monogram. Add the final logo, recoloured to the approved green.
- **Photography** (`src/content/images.ts`): none supplied. Pages use a labelled botanical illustration. Needed: hero, "nature meets science" macro, Kashi/founders, 3-4 approved Instagram photos (the Instagram grid appears automatically once added).
- **Products**: the strategy lists the liver formulation's name as unconfirmed. Edit `src/content/products.ts`. The category wording ("proposed iron syrup", "proposed liver-wellness formulation") comes from your document; have it checked against what you may lawfully say.
- **Ingredient library** (`src/content/ingredients.ts`): eight general botanicals with identity facts only, because the formulations' ingredients are not final. Have a botanist or Ayurvedic practitioner verify botanical names and notes. Add the actual ingredients once confirmed.
- **Journal articles** (`src/content/journal.ts`): drafts with no health claims; get practitioner review.
- **Development ledger** (`src/components/Ledger.tsx`): only "Formulation development" is marked current. Confirm and keep it up to date.
- **OG image** (`public/og-image.png`): placeholder wordmark card.
- **Domain**: set `VITE_SITE_URL` so canonicals, sitemap and Open Graph URLs are correct.

## Regulatory and legal items requiring professional verification

Not legal advice, and nothing here has been verified. Before selling any product in India, take advice from a qualified regulatory/legal professional on:

- Manufacturing licensing and product-category classification for Ayurvedic products (drug vs food/nutraceutical) and the authorities involved. Iron and liver-related formulations are especially likely to attract scrutiny of claims.
- Food-business registration or licensing if any product is classed as food.
- Labelling requirements, and rules on advertising and health claims for Ayurvedic products.
- Trademark registration for "Kaayra" and the product names.
- Personal-data obligations under India's Digital Personal Data Protection Act, 2023 and its rules, covering the launch list, contact messages and admin access.
- E-commerce, consumer-protection, GST and payments requirements before enabling checkout.
- Review of the Privacy Policy and Terms texts, which are drafts.

## Structure

```
api/subscribe.ts, api/contact.ts   Public form endpoints
api/admin/[action].ts              Admin API (login, session, subscribers, messages, export)
api/auth/[action].ts               OAuth sign-in/sign-up (start, callback, status, session, logout, delete-account)
server/                            Session tokens, OAuth access rule, members, origin and rate limiting, Supabase client
shared/                            Validation (browser and server), route metadata
supabase/                          SQL for the tables (launch_subscribers.sql, auth_members.sql, issues.sql, products*.sql, roles_mfa_audit.sql, variants_gallery.sql, inventory_orders.sql, refunds.sql, payments.sql, hsn_3004.sql, phase3_selftest.sql, refunds_selftest.sql, payments_selftest.sql)
scripts/prerender.mjs              Renders routes to static HTML, writes sitemap, robots, 404, admin shell
src/pages, src/components          Pages and UI (Admin is code-split)
src/content                        Journal, ingredients, products, founders, photo slots
```

E-commerce is deliberately absent. When products, licences and operations are ready, add a catalogue and checkout as new routes and API functions; the design system, layout and content structure are reusable without redesign.

## Admin: adding products

`/admin` > Products > "Add a new product" creates a private draft with name, form, pack size, MRP (internal), description, photo and labelling fields. Photos upload to a private Supabase bucket (run `supabase/products_catalog.sql` once). See `docs/ADMIN_PANEL_RESEARCH.md` for what a full e-commerce admin needs and what is still missing.

## Design

See `docs/DESIGN_SYSTEM.md` for the typography, colour and layout rules (run `npm install` after updating: new self-hosted fonts).
