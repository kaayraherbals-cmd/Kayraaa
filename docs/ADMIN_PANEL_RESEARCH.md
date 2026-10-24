> **Historical document.** Written when commerce was off. Current state: `COMMERCE_ENABLED = true` with a separate production live-sales gate. See `docs/COMMERCE_STATE.md`.

# What an e-commerce admin panel needs (research and gap list)

Prepared 17 October 2026 for Kaayra Herbals. Sources are listed at the end. Items marked *(general knowledge)* come from standard practice, not from a source fetched for this document. Nothing here is legal advice; have a lawyer or regulatory consultant confirm the Indian-law items before selling.

## 1. What the panel does today (this build)

| Area | Status |
|---|---|
| Admin sign-in, allowlist by `ADMIN_EMAILS`, signed HttpOnly session | Built |
| Audit log of admin actions (`admin_audit`) | Built, no viewer yet |
| Launch-list subscribers, contact messages, problem reports | Built |
| **Add product** (name, form, pack size, MRP, description, photo + alt text, labelling fields) | **New in this version** |
| **Photo upload** to a private Supabase bucket, served only for publicly approved products | **New** |
| Edit product, review checklist, banned-claim screening | Built (price and labelling fields added) |
| Selling, cart, checkout, orders | Deliberately off (`COMMERCE_ENABLED = false`) |

Price is stored in paise as an **internal** field. The `public_products` view does not expose it, and `APPROVED_FOR_SALE` still cannot be set.

## 2. What panels like this normally include

Common to the sources reviewed: role-based access, audit trail, search and filters, bulk actions, notifications, and a dashboard of sales, orders and stock.

Priority order for Kaayra, assuming selling starts later:

**P1: before any real sale**
1. **Orders**: list, filter by status, order detail, status changes (placed, paid, packed, shipped, delivered, cancelled), internal notes, CSV export.
2. **Inventory**: stock count per product, batch number and expiry per batch, low-stock alert, block ordering at zero. Batch and expiry matter for herbal products and for the expiry-date disclosure below.
3. **Refunds and returns** *(built: record only, see CHANGES_PHASE3.md)*: record reason, amount, who approved; link to the payment gateway refund.
4. **Roles**: start with owner, manager, support (one source recommends exactly this start). Today every admin can do everything; split destructive actions (delete, export, price change) to owner.
5. **Audit log viewer**: a read-only tab over `admin_audit`, filterable by actor and action. The data already exists.
6. **Payments reconciliation**: payment status per order, settlement matching. The Razorpay connector in your account suggests this is the planned gateway; confirm.

**P2: first months of selling**
7. Categories and collections, product ordering, featured flags, SEO title and description per product.
8. Multiple photos per product (this build supports one primary photo) and variants (pack sizes) with their own price and stock.
9. Discounts and coupons with start/end dates and usage limits.
10. Customer list: orders per customer, block account, data export and deletion on request.
11. Shipping: courier selection, tracking number, shipping charge rules, serviceable pincodes.
12. Tax: GST rate per product (HSN code), GST-compliant invoice generation *(general knowledge)*.
13. Dashboard: revenue and orders over time, average order value, top products, repeat-purchase rate, stock alerts.

**P3: later**
14. Reviews moderation, email/WhatsApp notification templates, abandoned carts, multi-user activity feed, MFA for admins.

## 3. Indian listing rules the product record must support

From the sources below:

- **Consumer Protection (E-Commerce) Rules, 2020**: listings must show country of origin and expiry date; the site must show return, refund, exchange, warranty and delivery information, payment methods and any fees, and the seller's geographic address and customer-care contact. Sellers supply GSTIN and PAN where applicable.
- **Legal Metrology (Packaged Commodities) Rules, 2011, Rule 10**: e-commerce listings must show manufacturer name and address, country of origin, common or generic name, net quantity, best-before or use-by date where applicable, and MRP.

The product form now captures: net quantity (pack size), MRP incl. taxes, country of origin, manufacturer/packer name and address, shelf life. **Not yet captured:** generic name, GSTIN/HSN, batch and expiry (needs the inventory module), dimensions. Add these before commerce is enabled.

## 4. Advertising and claims (matters most for Ayurvedic products)

- Rule 170 of the Drugs and Cosmetics Rules (advance approval of AYUSH advertisements) was omitted by the AYUSH ministry on 1 July 2024; the Supreme Court vacated its stay on that omission on 11 August 2025.
- The **Drugs and Magic Remedies (Objectionable Advertisements) Act, 1954** remains in force, and the Supreme Court has issued directions to states to enforce it (March 2025 order). ASCI also receives complaints against AYUSH advertising.
- Practical effect: keep the existing banned-claims screen (cure/treat/prevent, "clinically proven", "AYUSH approved", guarantees). It now also runs at product creation. Treat the screen as a safety net, not a legal review: a person should still approve every public description. *Whether a manufacturing licence is required for your specific products and how it interacts with online sale is a question for a regulatory consultant.*

## 5. Security checklist for the admin panel *(general knowledge)*

Done: server-side allowlist on every request, CSRF header + origin check, session cookie flags, login rate limits, audit trail, no secrets in the browser.

Added with image upload: validate files by their bytes (not file name or declared type), accept only JPEG/PNG/WebP, 2.5 MB cap, random file names, private bucket, `nosniff` and `default-src 'none'` headers on served images, browser-side re-encode strips EXIF/location data, upload rate limit, audit entry per upload.

Still to do: MFA for admin accounts (Supabase supports it), a distinct `owner` role, Vercel Firewall rate limit on `/api/admin/*`, backup/restore routine for the database and the `product-images` bucket, orphan cleanup for uploaded photos that were never saved to a product.

## 6. Setup steps for this version

1. Supabase SQL editor: run `supabase/products_catalog.sql` (after `products.sql`). It adds the price and labelling columns, widens the image-path check, and creates the private `product-images` bucket.
2. Redeploy. No new environment variables.
3. `/admin` > Products > **Add a new product** > upload a photo, set MRP, create the draft.
4. To show it on the site: open the draft, fill the review checklist, set status to **Approved for preview**. Price stays hidden.

## Sources

- DronaHQ, "10 Essential Features Every Admin Panel Needs" (roles, audit logs, bulk actions, search): https://www.dronahq.com/admin-panel-features/
- Appfyl, "App Admin Panel Development: Features, Roles and Cost" (owner/manager/support roles, ecommerce admin scope): https://blog.appfyl.com/en/blog/app-admin-panel-development/
- AdminLTE, "24 Best E-Commerce Admin Dashboard Templates 2026" (product record with media, pricing, inventory; core analytics set): https://adminlte.io/blog/ecommerce-admin-dashboard-templates/
- India Law, summary of the Consumer Protection (E-Commerce) Rules, 2020: https://www.indialaw.in/blog/consumer-protection-e-commerce-rules/
- The Week, "Govt notifies new rules for e-commerce entities" (country of origin, expiry date, refund/return disclosures): https://www.theweek.in/news/biz-tech/2020/07/25/govt-notifies-new-rules-for-e-commerce-entities.html
- CAIT research paper citing Legal Metrology (Packaged Commodities) Rules Rule 10 listing fields: https://cait.in//images/research/pdf_1743401500.pdf
- LiveLaw, Supreme Court vacates stay on omission of Rule 170 (11 Aug 2025): https://www.livelaw.in/amp/top-stories/supreme-court-vacates-stay-on-ayush-ministrys-notification-that-permitted-advertisements-of-ayurvedic-unani-siddha-drugs-300536
- Drishti IAS, Rule 170 explainer: https://www.drishtiias.com/daily-updates/daily-news-analysis/rule-170-of-the-drugs-and-cosmetics-rules-1945/print_manually
