# Independent testing guide (V5 Phase 2)

How to install this project from scratch and run every automated check. Every command below exists in `package.json` or
`scripts/`. Nothing here needs real credentials.

## 0. Status of this package: read first

Results below were produced by the preparer on 2026-10-21 in a sandbox with Node v22.22.2 and npm 10.9.7 (the independent audit
used Node 22.16.0 / npm 10.9.2, so re-run on your side).

| Check | Status | Result |
|---|---|---|
| `npm install --package-lock-only` | **Executed** | Lockfile regenerated from the real registry. Diff: 3 fonts added, 3 old fonts removed, nothing else. |
| `npm run check:lockfile` | **Executed** | PASS (root dependencies match `package.json`). |
| `npm ci` | **Executed** | PASS. The three font packages installed, including `fraunces/wght-italic.css`. |
| `npm run lint` | **Executed** | PASS, exit 0, no problems. |
| `npm run typecheck` | **Executed** | PASS, exit 0. |
| `npm test` | **Executed** | PASS, 49 files, 646 tests. |
| `npm run build` | **Executed** | PASS (client, SSR bundle, prerender of 15 routes + shells). Placeholder `VITE_SITE_URL` used, as designed. |
| `npm audit --omit=dev --audit-level=high` | **Executed** | PASS (exit 0). 2 moderate advisories (react-router 6.x / react-router-dom), none high or critical. |
| `npm audit` (all) | **Executed** | 22 advisories: 6 moderate, 13 high, 3 critical, all in dev/build tooling (vitest, vite, @vercel/node and their transitive deps) except the 2 react-router ones. Fixes need major upgrades; not applied. |
| Playwright UI check (`npm run ui:check`) | **Blocked** | `pip install playwright` worked, but `playwright install chromium` produced no browser in the preparer's sandbox (its network allow-list does not include the Playwright browser CDN). Not run. Not a website defect. |
| GitHub Actions workflow | **Not run.** | Edited and YAML-parsed only. |
| Database migrations, self-tests, Razorpay, Resend, Supabase | **Not attempted** | See section 11. |

This is not a claim that the project is fully tested: the browser check, CI, database and payment paths are still unexecuted.

Older reports in the repo (`test-results/RESULTS.md`, `docs/PHASE7_*_TESTING.md`) describe runs from earlier sessions.
They are not evidence about this package. Re-run everything.

## 1. Install Node.js

Required: **Node 22** (`.nvmrc` = 22; CI uses it; independent audit environment used 22.16.0 with npm 10.9.2).
`package.json` allows Node >= 20, but 22 is the tested line.

```bash
# with nvm
nvm install 22 && nvm use        # reads .nvmrc
node -v && npm -v                # expect v22.x and npm 10.x
```

## 2. Install dependencies

Needs network access to `https://registry.npmjs.org/` (or a mirror/cache that holds every package in the lockfile).

```bash
npm run check:lockfile   # offline; must print "match" before you continue
npm ci                   # clean install strictly from package-lock.json
```

Use `npm ci`, not `npm install`. If `npm ci` says the lockfile and `package.json` are out of sync, stop and report it; do not run `npm install` to paper over it.

Offline testers: `npm ci --offline` only works if your npm cache already holds every tarball, including
`@fontsource-variable/fraunces`, `@fontsource-variable/instrument-sans` and `@fontsource-variable/noto-serif-devanagari`.
Warm the cache first on a connected machine (`npm ci`), then copy `~/.npm/_cacache`.

## 3. ESLint

```bash
npm run lint        # eslint .
```

## 4. TypeScript

```bash
npm run typecheck   # tsc --noEmit
```

## 5. Vitest

```bash
npm test            # vitest run
```

Tests are unit tests. They do not call Supabase, Razorpay or Resend.

## 6. Production build

```bash
npm run build
# = tsc --noEmit && vite build && vite build --ssr src/entry-server.tsx --outDir dist-server && node scripts/prerender.mjs
```

Output: `dist/` and `dist-server/` (both git-ignored).

## 7. Install Playwright Chromium

`scripts/ui-check.py` uses **Python** Playwright. It is not an npm dependency, so `npm ci` does not install it.

```bash
python3 -m pip install playwright
python3 -m playwright install chromium            # browser binary
# Linux without system libraries (fresh container/CI):
python3 -m playwright install --with-deps chromium
```

The earlier audit failure ("Chromium executable not installed") was this step missing. It says nothing about the website.

## 8. Run the UI check

```bash
npm run build
npm run ui:check        # python3 scripts/ui-check.py
```

It serves `dist/` itself on `127.0.0.1:4173` and stubs `/api/*` with fixed data, so no database is needed. It tests 12 pages at
360/390/768/1024/1440 px plus interaction checks. **It overwrites `test-results/results.json` and `test-results/screenshots/`.**
Run it in a scratch copy if you want to keep the earlier files. To test an already-running server instead, set `BASE`.

## 9. npm audit

```bash
npm audit --omit=dev --audit-level=high     # packages shipped to customers (CI: blocking)
npm audit --audit-level=high                # everything incl. dev tooling (CI: reported, not blocking)
```

Section 0 has the numbers from this package's run. Advisories change daily, so re-run.

## Environment variables

None are required for sections 3 to 6, 8 and 9 on a developer machine.

| Variable | Used by | Effect |
|---|---|---|
| `VITE_SITE_URL` | `npm run build` (prerender) | Public https address, no path. If unset, a placeholder `https://kaayraherbals.example` is used and a warning is printed. |
| `VERCEL_ENV=production` or `REQUIRE_SITE_URL=1` | `npm run build` | Makes a missing, non-https or placeholder `VITE_SITE_URL` **stop the build**. Use a real value only if you set these. |
| `BASE` | `ui:check` | Base URL to test instead of the built-in static server. |

Do not set Supabase, Razorpay, Resend, `ADMIN_*` or `LIVE_SALES_*` variables for these checks. `.env.example` lists them for
deployment only. Never commit `.env.local`.

## 10. Lockfile history (resolved in this package)

The received lockfile described the previous fonts (`manrope`, `cormorant-garamond`, `tiro-devanagari-hindi`) and lacked the three
current ones. It was regenerated with `npm install --package-lock-only` against the live registry (no hand edits, hashes come from
npm). Versions resolved: all three new fonts at 5.3.0. Verify yourself:

```bash
npm run check:lockfile && npm ci
```

## 11. Not attempted by this guide

Supabase migrations and SQL self-tests (run only in CI's `database` job, which has not been run), concurrency tests, Razorpay test
mode, Resend delivery, scheduler, accessibility audit, real catalogue content.
