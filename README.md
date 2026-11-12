# Mainspring

A static, offline-first web app for TaskJuggler plans. The real TaskJuggler 3.8.4 scheduler
runs in the browser on ruby.wasm, and the plan stays a plain `.tjp` text file under version
control.

Status: Phase 0 (foundation and engine). See `docs/BUILD_PLAN.md` and `docs/phases/`.

## Run locally / Preview

Needs Node.js 22 (see `.nvmrc`).

```sh
npm ci
npm run build:engine   # packs ruby.wasm and TaskJuggler into public/engine/
npm run dev
```

Then open <http://localhost:4321/app>.

A public preview of `main` runs on GitHub Pages: <https://jackhale98.github.io/mainspring/>
(ADR-0006). It is built with `MAINSPRING_BASE=/mainspring/`; `npm run test:base-path` checks
that build locally.

## License

Mainspring is licensed under the GNU General Public License, version 2 or (at your option) any
later version (`GPL-2.0-or-later`); see `LICENSE`. It bundles TaskJuggler
(`engine/tj/`), which is licensed under GPL version 2 only; see `engine/tj/COPYING`. The other
third-party code in the built site is listed in `THIRD_PARTY_NOTICES.md`.
