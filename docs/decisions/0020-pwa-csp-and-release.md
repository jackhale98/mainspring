# ADR-0020: The PWA, the content security policy and the MVP release

Status: Accepted, 2026-11-23, by the user (Phase 4 approval, `docs/phases/phase-4.md` section 20).
Source: `docs/phases/phase-4.md` section 18, items 18.13 to 18.15, 18.19 and 18.21; sections 9
(service worker, install, persistence), 10.2 (CSP and headers) and 16.3 (release checklist); section
20 (18.14 decided as GitHub Pages for now, 18.15 accepted). Related: ADR-0001 (OpenSSL), ADR-0003 #5,
ADR-0006 (Pages preview), ADR-0012 (build name and update check), ADR-0016 (CI tiers).

## Context

- **No service worker exists yet.** The web manifest exists (start `./app/`, scope `./`, icons).
  Each build has a name, and `version.json` drives "New version · Reload" (ADR-0012).
- **The Pages preview runs under `/mainspring/`** (ADR-0006). GitHub Pages cannot set HTTP headers.
- **The ruby.wasm binaries link OpenSSL 3.2.0 statically** (ADR-0001). Mainspring never loads
  OpenSSL, but its code ships in `public/engine/`. ADR-0006 let the Pages preview ship the stock
  binary as an exception. That exception does not cover a real release.
- **The goldens are provisional.** They were recorded on Ruby 3.3.6 (ADR-0003 #5, amended).
- **The staging origin was planned as Cloudflare** (`wrangler.jsonc`). The user chose GitHub Pages
  for now, and a Cloudflare domain may come later (section 20).
- **The first-load budget is nearly full.** The Text-first load had about 3.3 KB of headroom.
- **CI takes 16 to 19 minutes.** The target was waived on 2026-11-23.
- **The full real-device pass is in Phase 6.** Phase 4 asks only for a short smoke (18.15).

## Decision

1. **OpenSSL-free ruby.wasm (18.13).** Build ruby.wasm without the openssl extension (task T13).
   Ship only that build, on Pages and on any later staging. Its feasibility is checked in wave 1.
   Accepting OpenSSL by ADR is the fallback. It is not recommended, and it is not taken. The
   release waits until T13 has merged and golden parity holds on the new build.

2. **Staging is GitHub Pages for now (18.14, as decided in section 20).**
   - The staging origin is the existing Pages site (ADR-0006). The deploy is the existing Pages
     workflow, run from `main`.
   - `deploy-staging.yml` is not written until the user moves to Cloudflare.
   - Pages cannot set headers. So the policy in decision 3 ships as a `<meta>` tag in the app page,
     and the page sets `<meta name="referrer" content="no-referrer">`.
   - `public/_headers` is still written (T19). A later move to Cloudflare then needs no code change.

3. **Content security policy (18.14; spec 10.2).** The app page carries this policy, without
   `frame-ancestors`, because a `<meta>` tag cannot set that directive.

   ```text
   default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
   connect-src 'self' https://api.github.com https://<worker host>; img-src 'self' data: blob:;
   style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none';
   form-action 'none'
   ```

   - `public/_headers` carries the full policy, with `frame-ancestors 'none'`, plus
     `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a restrictive
     `Permissions-Policy`.
   - `<worker host>` is the worker's host, chosen by the user at T10.
   - T19 first measures two things. The first is whether Astro inlines scripts, which then need
     hashes. The second is whether `style-src` can drop `'unsafe-inline'`.
   - `csp.spec.ts` fails on any `securitypolicyviolation` event across a full open, edit, sync and
     offline run under `/mainspring/`.

4. **Service worker and offline (spec section 9; no question in section 18).** The design is in the
   spec, and the user approved the spec on 2026-11-23.
   - The service worker is hand-written, about 200 lines, with no Workbox. It registers after the
     first schedule result, so the first open is not slowed.
   - There are two caches. `mainspring-app-<buildId>` holds the pages, the app chunks, fonts, icons,
     the manifest and the engine `manifest.json`. `mainspring-engine` holds the engine assets by
     content hash (ADR-0017).
   - Hashed assets are cache-first. `version.json` is network-only. The service worker answers only
     same-origin GET requests. It never touches `api.github.com` or the worker host.
   - A new service worker waits. The existing "New version · Reload" control drives the update (see
     ADR-0012 #6). Settings shows "Ready to work offline" once both caches are complete.
   - The wasm code-cache spike (T12) is adopted only if the numbers in spec 9.3 are met.

5. **Install (18.21).**
   - Chromium's install prompt is kept. It is offered as "Install app" in the app menu and in
     Settings.
   - One dismissable hint appears after the first save of a plan.
   - iOS shows the Add to Home Screen steps.
   - Nothing prompts on the first visit.

6. **Persistence request (spec 9.4; no question in section 18).** The app requests
   `navigator.storage.persist()` after the first save of a plan or after install. It never requests
   it on the first visit. Settings shows the result, the usage and the quota.

7. **Goldens and the real-device smoke (18.15, accepted in section 20).**
   - The user re-records the goldens on Ruby 3.4 before the release. Until then they stay
     provisional on Ruby 3.3.6.
   - The user runs a 15-minute smoke test on the Pages site, on a real device: an iPhone home-screen
     app and Android Chrome. The smoke covers open, edit, commit and offline.
   - The full device pass stays in Phase 6.

8. **CI time (18.19).** New specs use small plans. The service-worker specs run in their own shard.
   The CI time target stays waived. The gate file reports the wall time, and the user is told if a
   gate run takes longer than 22 minutes.

9. **Release checklist.** The checklist of spec 16.3 applies, with one change. The item "CSP and
   headers live (checked with `curl -I`)" becomes: the served page carries the CSP `<meta>`, and
   `csp.spec.ts` passes under `/mainspring/`. The checklist also needs the OpenSSL-free build
   (decision 1), a licence check with no embedded exception, the updated `THIRD_PARTY_NOTICES.md`,
   a secret scan that is clean, and the GitHub App and worker set up for the Pages origin.

## Consequences

- **Pages cannot send `frame-ancestors`.** On Pages the policy cannot stop other sites from framing
  the app. This protection returns with the Cloudflare headers.
- **The release and the preview are one site until a Cloudflare move.** Every merge to `main`
  reaches the staging site, and the user's smoke test runs on that same site.
- **The release waits for the OpenSSL-free build.** Until T13 merges, the stock binary stays on
  Pages under ADR-0006's exception. That exception ends when the new build ships.
- **A later move to Cloudflare** needs a hostname, the `deploy-staging.yml` workflow and the account.
  It needs no change to the policy or the headers, since `public/_headers` already exists.
- **Offline behaviour depends on the build name.** Each build has its own app cache. Engine files are
  checked by hash in the worker. A corrupt cache entry fails the boot check and is fetched again.
- **Real-device coverage is thin for the gate.** The 15-minute smoke test is the only real-device
  check in Phase 4. The full device pass waits for Phase 6.
- **CI stays slow for now.** The waived target means the run can exceed the old goal. The service
  worker shard and small plans are the means of keeping it down.

## Amendment 2026-11-23: one CI workflow may build the interpreter with Ruby (user)

Phase 0's CI rule says no Ruby is installed or invoked in CI (`docs/phases/phase-0.md`, the CI section and
item 15). Building ruby.wasm without the openssl extension (18.13, T13) needs a host Ruby as a build tool:
ruby_wasm's packager, the baseruby build and the extension-init generator. The user allows this in one
dedicated workflow, `.github/workflows/ruby-wasm.yml`, and nowhere else.

- The workflow only compiles the interpreter, checks the binary for OpenSSL, and runs the wasm engine's
  golden parity on it. It never runs TaskJuggler natively, never computes a schedule outside the wasm
  engine and never records goldens.
- `scripts/ci/no-ruby.mjs` allowlists that one file and still scans it for `tj3`, `engine/tj`,
  `golden:record` and `record-native`. Every other workflow stays Ruby-free.
- It runs by hand (`workflow_dispatch`) and on pushes that touch the build recipe, in its own concurrency
  group, with read-only permissions. It takes one runner for 30 to 60 minutes.
- Its inputs are pinned by SHA-256. Unpinned downloads are never built into an uploaded binary: hashes are
  recorded in a fetch-only run first, then pinned.
