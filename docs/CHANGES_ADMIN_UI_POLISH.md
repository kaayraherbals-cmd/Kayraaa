# Admin UI polish (smooth, fast, minimal)

Evidence rule: no network in the sandbox, so `npm ci`, typecheck, Vitest, `vite build` and a browser check were **not run**. Please run `npm run typecheck && npm run build` before deploying.

## Speed
- Tab screens (Products, Stock, Orders, Shipments, Refunds, Members, Activity log) load on demand (`React.lazy`) and are pre-loaded when you hover or focus the menu item, so the first open is quicker and the admin bundle is smaller.
- The table-label observer in `Admin.tsx` now runs at most once per frame instead of on every DOM change.
- Long lists use `content-visibility: auto` so off-screen cards cost nothing to paint.

## Smoothness
- Skeleton placeholders replace the bare "Loading…" lines; short fade when switching tabs; soft press/hover feedback on buttons, rows, cards; dialogs fade in. Only opacity/transform/colour animate. Reduced-motion is respected.

## Minimal and easy
- Sticky top bar; sticky sidebar (desktop) and sticky snap-scrolling strip (phone) so navigation is always in reach.
- Active section has a clear marker; the last open section is remembered for the session; page scrolls to top on switching.
- Lighter borders, one corner radius, calmer table heads, filters/search aligned and wrapping cleanly.

## Not changed
No function, endpoint, permission, field or screen was removed. Files: `src/pages/Admin.tsx` (shell), `src/pages/Admin*.tsx` (loading placeholder only), `src/admin.css` (final layer).
