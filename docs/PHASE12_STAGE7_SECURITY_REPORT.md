# Phase 12 Stage 7: security report (7B, partial)

Reviewed by reading only; nothing executed.
- New functions are `revoke ... from public, anon, authenticated` (server-only, same as the existing loyalty and bundle functions). `loyalty_order_snapshots` has RLS on and no grants.
- The points value is computed in the database from settings, never from the caller. The only caller inputs are the number of points and the expected total.
- Double redemption: `loyalty_reserve` locks the loyalty account row, has a unique reservation per order and a unique idempotency key; `loyalty_apply_to_order` is only reached for a non-replayed placement, and `checkout_place` serialises per member (advisory lock). Concurrency not tested.
- Shipping is now validated inside the transaction (previously trusted from the API).
- Open: authorization of owner screens, wallet and wishlist isolation, CSV export, webhook and refund tests are part of 7C to 7H and have not been done.
