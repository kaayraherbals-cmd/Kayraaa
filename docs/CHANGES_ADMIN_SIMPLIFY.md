# Admin panel: simpler layout and KH-ADMIN-004 fix

Evidence rule as before: the sandbox has no network, so `npm ci`, Vitest, ESLint, the full typecheck, `vite build` and any Supabase call were **not run**. Only `server/admin/dbHint.ts` was compiled and run on its own (output checked by eye).

## KH-ADMIN-004 ("The database request failed. Try again.")
Cause found in code: `api/admin/[action].ts` turns **any** thrown error into KH-ADMIN-004, and the Overview loaded every block together, so one missing table (for example `order_refunds`, `members`, `issues`, `orders`) failed the whole Overview. It usually means a file in `supabase/` has not been run on this database.
- Overview blocks now load independently (`server/admin/extras.ts`). A block that fails is left out and listed under "Some information could not be loaded" with what to do.
- Every 502 from the admin API now carries a `hint` (`server/admin/dbHint.ts`): missing table or function (names the SQL file), missing column, rejected key, or unreachable Supabase. The admin screens show the hint beside the code and reference.
- The error code and message are unchanged. Real cause still needs the SQL files run in the order in `docs/DATABASE_MIGRATIONS.md`; check `admin api error (<action>)` lines in the Vercel logs.
- Tests added (not run): `server/admin/dbHint.test.ts`, and an overview test in `server/admin/admin-api.test.ts`.

## Simpler admin
- The 11 tabs are now 5 groups: Overview, Shop (Products, Stock, Orders, Refunds), People (Members, Launch list), Inbox (Messages, Problem reports), Settings (Activity log, Security). A second row appears only when a group has several pages. Role permissions still decide what shows.
- "Inventory" is labelled Stock, "Issues" Problem reports, "Audit log" Activity log (labels only).
- `src/admin.css` (end of file): sentence case instead of spaced capitals, larger text and buttons, quieter overview cards, phone-friendly scrolling nav.
- No function, endpoint, permission or screen was removed. Not checked in a browser.

## Phase 5b: simpler product form and visibility fix
- **Cause of invisible boxes/text:** `src/theme.css` (Calm layer) sets `.btn { background: forest }` after `.btn--ghost { background: transparent }`, so outlined buttons (Discard, Add pack size, Upload/Replace photo, Remove, arrows, Previous/Next) were green text on green. Fixed in `src/admin.css` (end of file) with explicit colours for buttons, inputs (incl. disabled and placeholder), tables, notices and cards. Admin only; the public site is untouched.
- **Add product:** four boxes up front (name, form, pack size, price). Website text and photo, and label details, are folded under "optional". Same fields, same Create draft request.
- **Edit product:** the long form is now folded sections (Website text, Product and label details, Photos, Pack sizes, Ingredients, Formulation record). Website text and Pack sizes are open by default; the rest open on tap. Nothing removed.
- Not run: typecheck, ESLint, Vitest, build, browser check (no network in the sandbox).
