# Mainspring

A static, offline-first web app for TaskJuggler plans. The real TaskJuggler 3.8.4 scheduler
runs in the browser on ruby.wasm, and the plan stays a plain `.tjp` text file under version
control.

Status: Phase 0 (foundation and engine). See `docs/BUILD_PLAN.md` and `docs/phases/`.

## License

Mainspring is licensed under the GNU General Public License, version 2 or (at your option) any
later version (`GPL-2.0-or-later`); see `LICENSE`. It bundles TaskJuggler
(`engine/tj/`), which is licensed under GPL version 2 only; see `engine/tj/COPYING`. The other
third-party code in the built site is listed in `THIRD_PARTY_NOTICES.md`.
