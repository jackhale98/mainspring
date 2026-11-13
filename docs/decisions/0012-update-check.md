# ADR-0012: Check for a newer build and offer a reload

Status: accepted by the user, 2026-11-13 (the user asked for it; that request is the approval).
Out-of-phase work, done during Phase 2.

## Context

The public preview is a static site on GitHub Pages (ADR-0006). Browsers may reuse a cached copy
of the page for a while, and a phone's home-screen app can keep an old copy open for days, so a
user can run an old build without knowing it. The service worker that will own caching comes in
Phase 4; until then there is no way to see which build is running or to get the newest one on
purpose.

## Decision

1. **Every build has a name.** An Astro integration (`scripts/astro-build-id.mjs`) names the
   build after its commit and build time (e.g. `3f2a91bc-202611131402`). The app gets the name
   at build time, and the build writes the same name to `version.json` beside the pages. A dev
   server is named `dev` and never checks.
2. **The app checks for a newer one.** `src/lib/app/update-check.ts` fetches `version.json`
   past every cache (`cache: 'no-store'` and a query string). It checks 3 s after start, when
   the tab comes back into view (at most once a minute), and every 10 minutes. A different name
   means a newer build, because deploys only move forward. After one is found, it stops asking.
3. **A reload button appears.** When a newer build is found, the status strip shows "New version
   · Reload" (an icon with a dot on a phone).
4. **The engine popover always shows the build.** The popover (T24) lists this build, a "Check
   for updates" button and a "Reload" button, so a user can always see which build runs and
   reload on purpose.
5. **Reload fetches the page fresh, and asks first if work would be lost.** If the plan has
   unsaved edits, Reload asks first, as switching plans does. Reload then fetches the page with
   `cache: 'reload'` before calling `location.reload()`, so the browser's cached copy is
   replaced. The other files have hashed names, so they cannot be stale.
6. **Phase 4 reuses the same signal.** The service worker's update ("a new version is waiting")
   will drive the same button.

## Consequences

- A small extra request every 10 minutes while a tab is open: `version.json`, about 70 bytes.
- `version.json` is part of every build. The e2e spec `tests/e2e/update-check.spec.ts` checks
  that a current build offers nothing and that a different deployed name shows Reload, which
  reloads the page.
- Unsaved edits are still lost on reload until saving arrives in Phase 4. The confirmation says
  so.
