# Phase 12 Stage 7: test report (7B)

| Check | Result |
|---|---|
| `npm ci`, typecheck, lint, vitest, build, seo:check, npm audit | **NOT RUN** this session (no network, incomplete node_modules). Last real run: Stage 7A baseline, see the addendum in `PHASE12_STAGE7_INITIAL_AUDIT.md`. |
| `shared/money.test.ts` | 12 tests pass, but under a **temporary home-made shim** that mimics `describe/it/expect` (toBe, toEqual), run with `node --experimental-transform-types`. It is not real vitest. It also cross-checked `allocateExact` against `allocate` in `shared/bundles.ts` for 300 amounts. Run `npm test` for the real result. |
| `stage7_commerce.sql` | Structural check only (dollar-quote and parenthesis balance, function list). **Never executed.** |
| `stage7_selftest.sql` | Written, **never run**. |
| Existing self-tests edited for new semantics | Edited, **never run** after the edit. |
| Concurrency, browser, security tests | Not run. |

Do not read any line above as verification of the database changes.
