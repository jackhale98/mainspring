# ADR-0006: GitHub Pages preview

Status: accepted by the user, 2026-11-12 ("Deploy preview now"). Out-of-phase work, approved
during Phase 1.

## Context

Decision D8 in `docs/BUILD_PLAN.md` hosts the static build on Cloudflare with a GitHub Pages
mirror. The user wants a public preview now, before the Phase 4 release. Two things stood in the
way:

- **The base path.** A GitHub project site is served under the repository name,
  `https://jackhale98.github.io/mainspring/`, but the app assumed the site root: the engine
  worker fetched `new URL('/engine/', …)` and the home page linked to `/app`.
- **OpenSSL in ruby.wasm (ADR-0001, open issue).** The stock `@ruby/3.4-wasm-wasi` 2.10.1 binary
  statically links OpenSSL 3.2.0, which is Apache-2.0 and not compatible with GPL version 2.
  Mainspring never loads it, but the code ships inside `engine/ruby.<hash>.wasm.gz`. ADR-0001
  says this blocks any public release until a custom ruby.wasm without the openssl extension is
  built or a decision accepts it.

## Decision

1. **A public preview on GitHub Pages, deployed from `main`.** `.github/workflows/pages.yml`
   runs on every push to `main` and on demand (`workflow_dispatch`). It builds the engine
   (`npm run build:engine`) and the site with `MAINSPRING_BASE=/mainspring/`, checks that every
   URL the site uses for its own files is under that path (`scripts/ci/base-path-scan.mjs`), and
   deploys `dist/` with `actions/upload-pages-artifact` and `actions/deploy-pages` (concurrency
   group `pages`). It is a preview, not a release: no phase gate depends on it.
2. **The preview ships the stock ruby.wasm.** It uses the same engine build as every other
   build: `@ruby/3.4-wasm-wasi` 2.10.1, with OpenSSL 3.2.0 (Apache-2.0) linked in. The user
   accepts this for the preview only.
3. **The ADR-0001 open issue stays open.** It still blocks the real release on Cloudflare: before
   it, either ship a ruby.wasm built without the openssl extension (recommended) or record a
   decision that accepts it. This ADR's acceptance covers the preview only.
4. **The base path is configurable.** `astro.config.mjs` sets Astro's `base` from
   `MAINSPRING_BASE` (`scripts/astro-base.mjs`, which normalises it to `/name/` and refuses
   anything that is not a plain path). The default is `/`, so `npm run dev`, CI, the end-to-end
   tests, golden parity and the Cloudflare build are unchanged. Runtime URLs follow the base:
   pages link with `sitePath()` (`src/lib/site-path.ts`), and the worker finds the engine at
   `<base>engine/` from `import.meta.env.BASE_URL`, which Vite writes into the worker bundle at
   build time (`src/engine/engine-url.ts`). The worker does not derive the base from its own
   script URL, because `astro dev` serves the worker from its source path.
5. **Serving as Pages does.** Pages serves the engine's `.gz` files as plain `application/gzip`
   with no `Content-Encoding`; the worker already gunzips any asset that starts with the gzip
   magic before its hash check (`src/engine/manifest.ts`), so nothing changes there. A site
   deployed from an Actions artifact is published as is, without Jekyll, so `_astro/` is served
   and no `.nojekyll` is needed (`upload-pages-artifact` leaves dotfiles out in any case).
6. **A test keeps it working.** `npm run test:base-path` builds with `/mainspring/` and no dev
   pages, scans the output, serves it under `/mainspring/` with a stand-in that behaves like
   Pages (`scripts/serve-pages.mjs`: 404 outside the base, directory redirects, `.gz` as plain
   files) and, in desktop Chromium, loads the app from the home page link, waits for the engine
   to report Ready, schedules the Tutorial sample and asserts that nothing on the origin is
   requested outside `/mainspring/`, worker requests included. It runs in the `base-path` job of
   `ci.yml`.

## Consequences

- The user must set **Settings → Pages → Source: GitHub Actions** in the repository once, or the
  deploy job fails. The `github-pages` environment that Pages creates allows deployments from the
  default branch only, so a manual run from another branch stops at the deploy job.
- Until the open issue is closed, the public preview distributes OpenSSL's Apache-2.0 code inside
  the GPL-2.0 combination that ADR-0001 describes. The user has accepted that for the preview;
  it does not carry over to any release.
- A new root-absolute URL (for example a PWA manifest or service worker in Phase 4) breaks the
  preview; the base-path scan and test catch it. Phase 4's service worker must take its scope
  and precache URLs from the base as well.
- The preview builds from `main`; work merged elsewhere does not reach it until it is on `main`.
