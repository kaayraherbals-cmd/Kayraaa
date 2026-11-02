# Regulatory publication checklist

Use this before moving any product from internal development to a public preview, and again before any sale.
It is a working checklist, **not legal advice**. Have the items marked (L) reviewed by a qualified regulatory or legal adviser.

The incorporation certificate confirms that the company exists. It is not a manufacturing licence, a product approval, or
permission to sell Ayurvedic medicines.

## Status ladder (enforced by the admin Products tab and the database)

| Status | Meaning | Public? |
|---|---|---|
| DRAFT | Internal record, entered as supplied | No |
| IN_DEVELOPMENT | Being worked on internally | No |
| UNDER_REVIEW | Text and composition being reviewed | No |
| APPROVED_FOR_PREVIEW | Public "In Development" preview of approved text only | Yes |
| APPROVED_FOR_SALE | Separate authorisation; **cannot be set in this build** | Not enabled |

## A. Before APPROVED_FOR_PREVIEW (the site enforces the starred items)

- [ ] \* Public name chosen. (L) Check that the name does not name a disease or condition in a way that conflicts with advertising rules for drugs and remedies in India. Several working names (for example the "PILES", "PCOS" and "LEUCORRHOEA" products) name conditions: choose public names deliberately.
- [ ] \* Public description written (at least 20 characters), factual, in development wording only.
- [ ] \* Public text screened: no "AYUSH approved", "government approved", "clinically proven", "GMP certified", cure/treat/prevent, guarantee, "no side effects" or similar claims. The admin API rejects these phrases, but a human review is still required. (L)
- [ ] \* A named reviewer recorded, and the "claims reviewed" box ticked.
- [ ] Image (if any) is owned or licensed, self-hosted in `public/images/products/`, with real alt text, and does not imply an approved finished product. Packaging concepts carry "CONCEPT — NOT FOR COMMERCIAL USE".
- [ ] No price, benefit, dosage, usage instruction or health claim in the preview.
- [ ] The Medical Disclaimer page is live.

## B. Before ingredients are public

- [ ] \* Manufacturer-approved composition confirmed for public release (the "composition verified" box).
- [ ] \* Preservatives confirmed. **Iron Syrup and Multi-Vitamin Syrup have no preservatives supplied and need this verified.**
- [ ] Botanical identity checked for each ingredient (names were entered as supplied: for example "Annabhedi / Kasisa", "Yashad Bhasma", "Apoedika" need confirmation).
- [ ] Ingredient quantities are not published unless approved.
- [ ] Mineral and metal-based ingredients (for example bhasma, kasisa, shilajit) reviewed for applicable rules and testing. (L)
- [ ] Only then switch on "Show ingredients publicly". The database view also withholds the list unless all three flags are set.

## C. Before any sale (not available in this build)

- [ ] Manufacturing licence for the manufacturer, and licence or approval for each product category. (L)
- [ ] Label content approved: composition, manufacturer, batch, manufacturing and expiry dates, warnings, licence number. (L)
- [ ] Quality testing, safety review and stability data on file.
- [ ] Advertising and claims review of every page, image and social post. (L)
- [ ] Pricing, inventory, GST, shipping, returns and refunds, grievance contact, and consumer-law pages ready.
- [ ] Payment provider onboarded, privacy policy updated, and written business approval to enable commerce.
- [ ] Then follow `ECOMMERCE_ARCHITECTURE.md`.

## D. Things this site must not say without evidence

"AYUSH Approved", "Government Approved Medicine", "Clinically Proven", "GMP Certified", disease-cure or treatment claims, guaranteed
results, safety claims such as "no side effects". `supabase/products.sql`, `shared/products.ts` and an automated test guard these.

## E. Company details to verify before wide publication

- Registered location is published as "Varanasi, Uttar Pradesh, India". The full mailing address on the certificate has a first line
  ("00THARI") that should be checked against the original before it is used anywhere.
- PAN and TAN appear on the certificate and are deliberately never published (a test fails the build if they appear).
- Founder information: none was supplied, so none is shown. Add verified names, roles and qualifications to `src/content/founders.ts`.
