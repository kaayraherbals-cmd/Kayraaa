# Phase 12 Stage 7: remaining issues (after 7B)

## Blockers that need an owner decision (loyalty stays OFF; the database refuses `enabled = true` until both are confirmed)
1. **GST treatment of a points redemption.** Is it a discount on the supply (reduces taxable value) or a payment-side tender? The code keeps it out of the taxable discount (finance and invoices unchanged). Needs a tax decision.
2. **Refund and debt policy.** Existing SQL (`loyalty_reverse_for_order`) records `debt_points` when earned points were already spent, restores redeemed points only on full refund or cancellation, and reverses earned points pro rata on `refunded / total`. These were starting choices. Earning basis now excludes the loyalty saving (what was paid). Owner must confirm or change all of it.
3. Loyalty defaults (10 points per Rs 100, 100 points = Rs 10, max 20%, 7-day activation) are unconfirmed starting values.

## Work not started (7C to 7H)
- **7C** TypeScript checkout path: `server/checkout.ts` still calls `checkout_place`; `api/checkout` has no loyalty or bundle input; cart has no bundle lines (`cart_items` is variant-only). The request hash (`canonicalRequest`) must include bundle ids and loyalty points, otherwise a retry with different points would replay the earlier order. Failure and success lifecycle for loyalty are handled by existing triggers (cancel releases, paid commits and earns) but are untested.
- **7D** DONE as written, unrun (see changelog). **7E** part 1 done, unrun (owner bundle screen, read-only bundles page). Still missing: bundle lines in the cart, quote and checkout screen, API passing bundle ids to `checkout_place_full`, gift messages. **7F** wallet page, owner loyalty screen, scheduler for `loyalty_activate_due` and `loyalty_expire_due`.
- **7G** Phase 8 finance: loyalty redemption is NOT in `finance_lines`; once loyalty is live, revenue would be overstated by the redeemed amount until this is done. Points liability, bundle revenue and component cost reporting, and reconciliation of refunds made directly in the Razorpay dashboard (webhook currently only audits `refund.processed` for an unknown refund id).
- **7H** final reports.

## Unverified
Everything in `stage7_commerce.sql` and `stage7_selftest.sql`. No concurrency test for combined bundle + loyalty checkout exists yet. No refund-after-loyalty SQL test exists yet.
