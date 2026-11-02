# Admin performance pass (v5 phase 12)

Cause of the lag, in order of impact:

1. Products tab: every product mounted its photo gallery and pack-size editor on load, each fetching its own data (2 requests per product plus every form in the DOM). Bodies now mount on first open.
2. `onExpired` was a new function on every render and is an effect dependency in the product editors, orders, shipments, inventory and others. Any re-render of the dashboard (for example typing in the top search) refetched their data. It is now a stable callback.
3. The top bar lived inside the dashboard component, so each keystroke or menu toggle re-rendered the open section. It is now its own memoized component (`AdminTools`).
4. Every tab switch started from an empty screen. `src/lib/adminKit.tsx` now shares identical in-flight GETs and keeps the last good reply so lists and the overview paint instantly and refresh behind it. The cache is cleared after any write, sign-out or 401.
5. A MutationObserver relabelled every table on every DOM change. It now touches only changed tables, once per frame.
6. Tab changes smooth-scrolled to the top; now instant.
7. Paint cost: about 18 `backdrop-filter` blurs (top bar, rails, every overview card), large hover shadows and a gradient shimmer repainting each frame. Replaced with solid surfaces, opacity-only motion and an opacity pulse (end of `src/admin-premium.css`).

Not changed: the public site CSS and fonts are still bundled with the admin route (they come from `src/main.tsx`). Splitting them is the next step if the first load still feels heavy on slow phones.
