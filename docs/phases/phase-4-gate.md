# Phase 4 gate evidence

## Status

Kept at the top of this file by the main session (ADR-0016 section 5). Update it at the end of every
batch, before the push. **Paused by the user on 2026-11-24** after T14 part one, T5 and T6; nothing
else is running.

| Item | Now |
| --- | --- |
| Last green commit on main | `8b1fea69` (branch run 45329691215, 2026-11-24, 20 min 36 s; main fast-forwarded) |
| Done and on main | T1 (ADR-0019, ADR-0020 and amendments), T3 (interfaces), T4 (plans kept in the browser), T5 (folder provider, import, export; no controls yet), T6 (merge), T13 wave 1 and its CI workflow (the OpenSSL-free ruby.wasm builds and keeps golden parity in CI; the app still ships the stock engine), T14 part one (sync status control and panel; polish 22), T18 (export of the Gantt as PNG and of tasks as CSV) |
| Not started | T27a and T27b (New file), T7 (sync controller), T8 and T9 (GitHub provider and its fake), T11 and T12 (service worker, code-cache spike), T13 finish (switch the engine, notices), T14 part two, T15 (plan chooser, the controls for T5), T16 (conflict view), T17 (settings, install), T19 (CSP), T20 (the rest of the fixtures), T21 to T24, T25, T26; polish 20 and 21 |
| Waiting on the user | T10 (register the GitHub App, the worker's host); the decisions below |
| First-load bytes | Visual-first 335,532 of 340,000; Text-first 442,750 of 445,000 (CI-style build, 2026-11-24). Phase 4 has added about 5,970 (Visual) and 6,100 (Text) of the 6,000 allowed (section 24): the allowance is used up with T11, T14 part two and T15 still to come |
| iPhone 14 skips | None outside the allowlist (5 of 6 entries); the four folder tests skip by capability (no `showDirectoryPicker` in WebKit) |
| CI wall time | About 20 min; the target stays waived (18.19) |

## Decisions waiting for the user

1. **First-load allowance.** Used up (row above). Raise it again, or have a perf pass move first-load
   code into lazy chunks before T11, T14 part two and T15.
2. **Merge speed (section 23).** The per-step rule looks met (steps of 3 to 8 ms typical), but the whole
   merge on `fedora-res` measured about 42 ms of CPU clean and 60 ms with a conflict on a loaded
   machine, against 50 ms p90. Numbers from a quiet machine are still owed. Proposal: keep the
   per-step rule and relax the whole-merge figure.
3. **New errors or warnings after a merge mean "needs review"** (the merge contract's G3, a
   requirement on T7): an amendment to 18.9, which today only blocks a merge that does not schedule.
4. **Two tasks or two resources appended at the same place by both sides** are a conflict with
   "Keep both" (rule 3). Merging them without asking would be a spec change.
5. **320 px phones.** The plan title has 36 px after the brand mark went. The next step would move the
   project-settings button into the status card or the Plan tab.
6. **`ruby/setup-ruby`** runs at its moving `v1` tag in `ruby-wasm.yml`; pin it to a commit the user
   trusts.
7. **Two ADRs are numbered 0016** (`0016-trial-shared-page.md`, `0016-ui-hardening.md`).

## Open items and watch list

- **Engine switch (T13 finish).** In Chromium the first Fedora schedule on a fresh page was about
  0.85 s slower on the new binary in two local rounds (4.5 s against 3.7 s); later runs were alike, and
  Node was not slower. Check the CI figures before the switch.
- **Merge, outside its guarantee (types.ts G3).** Interactions across blocks or files and meanings that
  span keywords are left to the schedule check; the cases known to pass the engine silently are named
  there. A move across files keeps a coarse conflict.
- **T7 must know** (contract notes in `src/lib/storage/types.ts`): a folder's `moved.head` can equal
  the base after a content-only change, so always read and merge by text; an added file can be left
  empty by a failed write; `MergeContext.files` wants ours' parsed files.
- **Flaky under load, seen once each locally:** `folder.spec.ts` "asks which plan in a folder of
  several" (passed 16 of 16 when repeated); `src/lib/gantt/hit.test.ts` "does not allocate per call"
  (passed alone). The codec and autosave property tests got explicit 30 s timeouts.
- **Unverified on real devices** (18.15, at the release): Safari's clipboard for "Copy Gantt as
  image"; T15's pickers and share sheet on an iPhone.
- **Before the release:** the user re-records the goldens on Ruby 3.4; `THIRD_PARTY_NOTICES.md` still
  lists OpenSSL and lacks compiler-rt and the Rust parts of wasi-vfs (T13 finish).
