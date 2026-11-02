# V5 Phase 2: test-ready preparation

Scope: dependency configuration and test reproducibility only. No UI, typography, payment, inventory, product, order, auth,
admin, migration or live-sales code was changed.

## Honest status

- **Lockfile: FIXED and verified.** Registry was reachable; `npm install --package-lock-only` regenerated `package-lock.json`
  (diff: 3 fontsource-variable packages added, 3 old fonts removed, nothing else). `npm run check:lockfile` and `npm ci` pass.
- **Executed and passing:** lint, typecheck, Vitest (49 files / 646 tests), production build, `npm audit --omit=dev --audit-level=high`.
- **Executed, advisories open:** full `npm audit`: 22 (6 moderate, 13 high, 3 critical) in dev tooling plus 2 moderate in react-router.
- **Blocked:** Playwright UI check, Chromium could not be downloaded in the preparer's sandbox.
- **Not run:** GitHub Actions workflow, database job, Razorpay, Resend, Supabase.
- The project must not be described as fully tested.

## Changed files

| File | Change | Why |
|---|---|---|
| `scripts/check-lockfile.mjs` (new) | Offline, dependency-free comparison of `package.json` and the lockfile root. | Gives a readable diagnosis without the registry; runs before `npm ci` in CI. |
| `package.json` | Added script `check:lockfile`. No dependency or version changed. | Exposes the checker. |
| `.github/workflows/ci.yml` | `app` job: Node from `.nvmrc`, lockfile check before `npm ci`, timeout. New `audit` job: runtime deps audit is blocking; full audit is reported (summary + log) but non-blocking. `database` job untouched. | Previously the only audit step had `continue-on-error: true`, hiding runtime advisories too. |
| `package-lock.json` | Regenerated with `npm install --package-lock-only`. | Fixes the mismatch. |
| `.nvmrc` | `20` to `22`. | Matches CI (22) and the audit environment (22.16.0). `engines` still `>=20`. |
| `.gitignore` | Added `dist-server`. | Build output from `npm run build` was not ignored. |
| `docs/INDEPENDENT_TESTING.md` (new) | Full install/test instructions and executed/blocked/not-attempted table. | Task 3. |
| `docs/V5_PHASE2_CHANGES.md` (new) | This file. | Deliverable. |
| `test-results/RESULTS.md` | Added a notice on top; original text kept. | It claimed `npm ci: ok` and passing tests for an earlier state; the audit contradicts that for this package. |
| `SESSION_RULES.md` | Added a lockfile rule. | Prevents fabricated lockfiles in future sessions. |

Unchanged on purpose: `src/main.tsx`, all styles, all tests, `scripts/ui-check.py`, everything under
`api/`, `server/`, `shared/`, `supabase/`.

## Font import review (static, no install)

`src/main.tsx` imports `@fontsource-variable/fraunces`, `.../fraunces/wght-italic.css`, `@fontsource-variable/instrument-sans`,
`@fontsource-variable/noto-serif-devanagari`. All three package names match `package.json`. The family names in
`src/styles/tokens.css` (`'Fraunces Variable'`, `'Instrument Sans Variable'`, `'Noto Serif Devanagari Variable'`) match the names
these packages register. Verified after install: `@fontsource-variable/fraunces/wght-italic.css` exists in the installed package and the production build succeeds.

Observations, not changed: `shared/mailTemplates.ts` still names Cormorant Garamond and Manrope in email inline styles (email
clients cannot load these fonts anyway, so they fall back); `tokens.css` keeps 'Tiro Devanagari Hindi' as a fallback name.

## CI review notes

- `npm ci` is already a clean install. `npm audit` high/critical in dev tooling was open in earlier reports, so a blocking full audit
  would turn CI red today; it is reported instead, and the runtime audit blocks.
- CI does not run the Playwright UI check (Python plus a browser download). Add it if wanted.
- The workflow has never run on GitHub.

## Remaining blockers

1. Run `npm run ui:check` where Playwright Chromium can be installed.
2. Run the workflow once on GitHub (including the `database` and new `ui-check` jobs).
3. Dev-tooling advisories (vitest, vite, @vercel/node) and react-router moderates need major upgrades; deliberately not changed here.

## Follow-up: Playwright UI check in CI

- `.github/workflows/ci.yml`: new `ui-check` job (build, Python Playwright, `playwright install --with-deps chromium`, `npm run ui:check`,
  upload `test-results/`). `scripts/ui-check.py` always exits 0, so the step fails if the log contains an `ISSUE` line or a non-empty
  `failed: [...]` list. The script itself is unchanged.
- **Not run.** The job has never executed (workflow YAML parses; nothing more is verified). The UI check remains unexecuted anywhere.
