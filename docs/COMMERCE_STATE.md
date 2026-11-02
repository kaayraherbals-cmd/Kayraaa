# Commerce state (canonical, read this first)

- `COMMERCE_ENABLED = true` in `shared/commerce.ts`. This is the owner's explicit decision (Phase 7 Step 3). **Do not set it back to false** to "make something safe": it enables the shop features, it does not authorise real payments.
- Real (live) payments are controlled separately and only in production by `shared/liveSales.ts`: production needs `LIVE_SALES_APPROVED=on` plus `LIVE_SALES_APPROVED_BY` and `LIVE_SALES_APPROVAL_REF`. Default is not approved.
- Staging / preview / local: bag, checkout, Razorpay TEST payments, order history and shipping open automatically; orders are marked test; live keys are refused.
- Production before approval: catalogue and bag only; checkout, pay and verify return 404; admin order creation blocked. Webhooks, refunds and reconciliation keep working.
- To close production sales quickly: remove `LIVE_SALES_APPROVED` in Vercel and redeploy. Do not edit COMMERCE_ENABLED.
- Older documents (Phase 4 to Phase 7 Step 2) describe commerce as off. They are history and carry a banner pointing here.
- `shared/commerce.test.ts` fails if the switch is false and if the current-state docs claim it is.
