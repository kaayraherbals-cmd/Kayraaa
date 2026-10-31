> **Current state:** `COMMERCE_ENABLED = true`; production live payments need the separate approval in `shared/liveSales.ts`. See `docs/COMMERCE_STATE.md`.

# E-commerce architecture

> **Update:** the owner has enabled selling. `COMMERCE_ENABLED = true` in `shared/commerce.ts`. Products still need status Approved for sale, an active pack size with price, GST and HSN, and in-date stock; otherwise the shop shows unavailable. Razorpay keys must be set (see docs/RAZORPAY_SETUP.md). Some old tests that assumed selling was off are marked `it.skip` and need rewriting.


**Historical status (superseded, see docs/COMMERCE_STATE.md):** commerce was OFF; `COMMERCE_ENABLED` was false. There are no cart, checkout, payment or order
routes, product pages show no price or buy control, and the public API always returns `purchasable: false`. A test enforces all three.
Do not turn commerce on because the company is incorporated. Activation needs written business approval and the items in section C of
`REGULATORY_PUBLICATION_CHECKLIST.md`.

## Keep the current stack

React + TypeScript + Vite on Vercel, Supabase (Postgres) behind server-side API functions. No migration to Shopify or WordPress is needed
or proposed. Payments would be a hosted provider (for example Razorpay or Stripe) so card data never touches this site.

## Proposed data model (create only when approved)

| Table | Purpose |
|---|---|
| `products` (exists) | One row per formulation, with the publication status ladder |
| `product_variants` | Sellable SKUs: pack size, GST rate, MRP, barcode, status |
| `inventory` | Stock per variant and batch: batch number, manufacturing and expiry dates, quantity, reserved |
| `carts`, `cart_items` | Server-side carts keyed to a session or customer |
| `customers` (extends `members`) | Account, addresses, consent records |
| `orders`, `order_items` | Immutable snapshot of what was sold: price, tax, label version, batch |
| `payments` | Provider reference, status, amount, webhook events (idempotent) |
| `shipments` | Carrier, AWB, tracking events, delivery status |
| `returns`, `refunds` | Return requests, reasons, inspection outcome, refund status |

All tables server-only (RLS on, no public policies), as with `members` and `products`.

## API surface (all under `/api`, all checking `COMMERCE_ENABLED` and product status on the server)

`GET /catalog` (approved-for-sale only) · `POST /cart` · `POST /checkout` (creates order + payment intent) · `POST /payments/webhook`
(signature-verified) · `GET /orders/:id` (owner only) · `POST /returns` · admin: inventory, orders, shipments, refunds.

## Rules to carry over

1. A product is purchasable only if `status = APPROVED_FOR_SALE` **and** `COMMERCE_ENABLED` **and** an in-stock, in-date batch exists. Check on the server at cart, checkout and payment time, never in the browser alone.
2. Prices are stored server-side. Never accept a price from the client.
3. Orders snapshot the approved label and composition version sold.
4. Webhooks are idempotent and signature-verified. Payments reconcile against provider records.
5. Ordering requires a signed-in account (`ORDER_REQUIRES_SIGN_IN`); every order endpoint checks the session. Customer accounts reuse the existing sign-in (Google or email and password). Add purchase history, addresses and erasure.
6. Returns and refunds follow the policy published at launch. Legal pages (shipping, returns, refunds, grievance officer, consumer information) must exist before enabling.
7. The `PublicProduct` type has `purchasable: false` as a literal type today. Changing it is a deliberate, reviewed code change.

## Suggested phases

1. Catalogue and variants, inventory with batches (admin only).
2. Cart and checkout in test mode behind `COMMERCE_ENABLED`, never in production.
3. Payments, webhooks, order management.
4. Shipping integration and tracking.
5. Returns, refunds, customer account area.
6. Go-live review against section C of the publication checklist.


## Status after Phase 3 (back office)

Built and admin-only, nothing public: pack-size variants (own SKU, MRP, GST/HSN, low-stock level), several photos per product, stock by batch with expiry and an append-only ledger, orders with FEFO batch allocation and a status ladder, roles, two-step verification and an audit-log viewer. **Selling is still off**: `COMMERCE_ENABLED` is `false` and order creation returns `KH-ADMIN-010` until it is changed in code. Still not built: payments and reconciliation, refunds and returns, invoices and GST invoice numbering, shipping integration, COD, customer-facing checkout and order tracking, coupons.

## Status after Razorpay server work (18 October 2026)

Razorpay was chosen as the hosted gateway. Built and still off: payment records, a signed idempotent webhook, a locked admin action to start a charge, and gateway refunds from the Refunds tab (`docs/RAZORPAY_SETUP.md`). Still not built: customer checkout and the browser Checkout script, payment status on the order screen, settlement matching, COD, coupons, invoices, courier integration.

## Status after Phase 5, Section 4 (customer payment, test mode)

Built behind flags, never run against Razorpay or a database: customer payment through Razorpay Checkout, server-side confirmation with Razorpay, one database function for paid / failed / mismatch / late events (browser callback, webhook and reconciliation share it), customer cancel of an unpaid order, release of stock from unpaid orders after the 30-minute window, and a payment-failure screen. Still not built: emails, shipments and tracking, saved addresses, order history, admin monitoring, refund requests by customers. See `docs/CHANGES_PHASE5.md`.
