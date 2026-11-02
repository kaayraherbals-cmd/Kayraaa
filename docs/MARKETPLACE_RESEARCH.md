> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# Research: a production-grade Ayurvedic store (Amazon/Flipkart-style experience)

Research date: 17 October 2026. Sources are listed at the end. Treat figures as directional. This is business and UX research, not legal advice: get the licensing and labelling points confirmed by a regulatory consultant before enabling sales.

## 1. What the rules say (this decides when "ordering" can switch on)

- Ayurvedic, Siddha and Unani medicines are regulated under the Drugs and Cosmetics Act, 1940 and Drugs Rules, 1945, with manufacturing licences and GMP conditions (Schedule T for these systems). Ayush has its own vertical inside CDSCO.
- The Central Consumer Protection Authority advised e-commerce platforms to sell Ayurvedic, Siddha and Unani drugs that contain ingredients listed in Schedule E(1) only after the buyer uploads a valid prescription. Such containers carry a "to be taken under medical supervision" caution in English and Hindi.
- The Consumer Protection (E-commerce) Rules, 2020 expect seller details and a grievance officer's name and contact to be shown clearly.
- Misleading advertising of Ayush products draws action (Drugs and Magic Remedies Act, 1954).
- Practical effect for Kaayra: the existing publication ladder (`APPROVED_FOR_SALE`), the master switch (`COMMERCE_ENABLED = false`) and the "no unsupported claims" rules are right. Ordering should open only after: manufacturing/loan licence and approved labels, a decision on whether any product contains Schedule E(1) ingredients (prescription step), grievance officer and policy pages, and written business approval.

## 2. What the best stores do (patterns worth copying)

- Mobile first: most Indian D2C traffic is on phones. Thumb-reach search, menu and add-to-bag; a sticky add-to-bag bar; fast pages on mid-range Android over 4G.
- Trust above the fold: delivery estimate, return policy, secure payment, real reviews, licence and batch information (only when real).
- Payments: UPI, cards, wallets and COD visible early. Hosted checkout (Razorpay or similar) so card data never touches the site.
- Search and filters are the most underrated conversion tool; shoppers search by concern, ingredient and product type.
- Sign-in friction: sources agree that forcing account creation before checkout is a common conversion killer; faster sign-in (Google, mobile OTP) and returning-customer one-tap checkout recover most of it. One case study of an Ayurvedic D2C brand reported much higher checkout conversion after adding one-tap logins.

## 3. Decision taken here: sign-in required for ordering

You asked for sign-in to be mandatory for ordering. It is recorded as a rule (`ORDER_REQUIRES_SIGN_IN` in `shared/commerce.ts`) and the gate is built. To limit the conversion cost the research warns about: Google is one tap, email and password also work, and mobile OTP sign-in is the next addition. A guest-checkout switch can be added later if the numbers say so.

## 4. What this build adds now (no selling)

- Front page: announcement bar, account menu in the header (Sign in, Create account; avatar menu when signed in) and a "Join Kaayra early" account block with Google and email.
- Google button always visible on sign-in and sign-up; if the server is not configured the button explains it instead of vanishing.
- Product pages: an "Ordering" gate that asks people to sign in now so they are ready, with no price, cart or buy control.
- Commerce stays OFF: no cart, checkout, payment or order routes (a test still enforces this).

## 5. Roadmap to a full store (needs your approval at step 2)

1. Brand and UX layer (safe now): search, mega-menu by concern and product type, trust bar, richer product pages (ingredients, usage, FAQs), reviews framework, mobile sticky bar, performance pass.
2. Commerce phase 1 (test mode only): variants, inventory with batches, server-side prices and GST, cart, address book, order snapshots. Behind `COMMERCE_ENABLED`.
3. Payments and orders: hosted payments, signature-verified webhooks, order emails, admin order management.
4. Shipping and returns: courier integration and tracking, returns and refunds, legal pages, grievance officer.
5. Go-live review against `REGULATORY_PUBLICATION_CHECKLIST.md` section C, then flip the switch.

## Sources

- Drugs and Cosmetics Act framework and Ayush quality measures: https://indianmasterminds.com/news/ayush-products-quality-framework-digital-market-regulations-government-218654/
- CCPA advisory on Ayurvedic, Siddha and Unani drugs (Schedule E(1), prescription, grievance officer details): https://vikaspedia.in/health/ayush/ccpa-issues-advisory-to-ecommerce-platforms-on-sale-of-ayurvedic-siddha-and-unani-drugs
- Labelling caution for Schedule E(1) products: https://www.biospectrumindia.com/public/article/pdf/21633
- Licence types: https://www.bajajfinserv.in/ayush-license
- Indian D2C conversion (guest checkout, Google login, COD, mobile): https://www.fynd.com/blog/how-to-build-a-d2c-website-that-converts-in-2026-for-indian-brands
- Ayurvedic D2C one-tap login case study: https://checkout.shiprocket.in/blog/ayurvedic-d2c-brand-achieved-47-percent-checkout-conversion-using-fastrr/
- Mobile-first store setup for India: https://echai.ventures/d2c/d2c-build-store/mobile-first-store-setup
