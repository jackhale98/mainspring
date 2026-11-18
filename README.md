# Mainspring

A static, offline-first web app for TaskJuggler plans. The real TaskJuggler 3.8.4 scheduler
runs in the browser on ruby.wasm, and the plan stays a plain `.tjp` text file under version
control.

Status: Phase 2 (Gantt and visual editing) in progress. See `docs/BUILD_PLAN.md` and `docs/phases/`.

## Run locally / Preview

Needs Node.js 22 (see `.nvmrc`).

```sh
npm ci
npm run build:engine   # packs ruby.wasm and TaskJuggler into public/engine/
npm run dev
```

Then open <http://localhost:4321/app>.

To run the end-to-end specs on an iPhone 14 emulation (WebKit), install its browser once, then build
and run a spec (the preview serves `dist/`, so rebuild after a source change):

```sh
npm run setup:webkit   # WebKit into PLAYWRIGHT_BROWSERS_PATH, else .cache/pw-webkit; checks its system libraries
npx astro build        # MAINSPRING_DEV_PAGES=1 as well for the specs that open the dev pages
npm run test:e2e:iphone -- tests/e2e/gantt-undo.spec.ts
```

On Linux, if WebKit does not start for a missing system library, `setup:webkit` prints
`sudo npx playwright install-deps webkit`; `npm run setup:webkit -- --deps` runs it (it uses apt,
so it never runs unasked). Only `tests/e2e/lib/webkit-allowlist.ts` may skip a test
on WebKit; `node scripts/ci/webkit-skips.mjs` (run by the `check` job) fails on any other skip.

A public preview of `main` runs on GitHub Pages: <https://jackhale98.github.io/mainspring/>
(ADR-0006). It is built with `MAINSPRING_BASE=/mainspring/`; `npm run test:base-path` checks
that build locally.

## License

Mainspring is licensed under the GNU General Public License, version 2 or (at your option) any
later version (`GPL-2.0-or-later`); see `LICENSE`. It bundles TaskJuggler
(`engine/tj/`), which is licensed under GPL version 2 only; see `engine/tj/COPYING`. The other
third-party code in the built site is listed in `THIRD_PARTY_NOTICES.md`.
