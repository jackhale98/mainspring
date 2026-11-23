# ADR-0019: Plans in the browser, folders and GitHub: storage, sync and auth for the MVP

Status: Accepted, 2026-11-23, by the user (Phase 4 approval, `docs/phases/phase-4.md` section 20).
Source: `docs/phases/phase-4.md` section 18, items 18.1 to 18.12, 18.16 to 18.18 and 18.20 to 18.22
(the items that bear on storage and sync), with the detail each item names in sections 6, 7, 8 and
10.1, and section 20 (the user's decisions of 2026-11-23). Related: ADR-0001 (Dexie, Mycelium),
ADR-0002 #13, ADR-0003 #1, ADR-0008 #1 and #3, ADR-0018 (`changesSince`), ADR-0020 (PWA, CSP, release).

## Context

- **Plans live only in memory today.** A plan is seeded from a bundled sample or from "New plan…".
  Reloading the page discards its edits. The note in `strings.ts` says so. The only stored data is
  UI preferences in `localStorage`, and ADR-0008 #3 says no plan text is ever stored.
- **Phase 4 must keep plans.** A plan has to survive a reload, work offline after one visit, and
  reach another device. There is no backend of our own.
- **iPhone and iPad cannot open or save into a folder.** On those devices a plan can be kept in
  browser storage, exported through the share sheet, or synced with GitHub. The system can clear
  browser storage on iOS after a period without use. GitHub is the recommended way to work on one
  plan from a phone and a computer.
- **GitHub's sign-in endpoints do not allow CORS.** The web-flow token exchange needs a client
  secret. The REST API at `api.github.com` does allow CORS with a bearer token. The existing worker
  can relay the two sign-in calls.
- **OneDrive and Dropbox** are in the Phase 4 bullet as "then", and in v1 in the product scope.
  Section 19 of the spec records that conflict.
- **Two library choices in the build plan need a decision.** Dexie (D1) is Apache-2.0, which
  ADR-0001 says must be replaced or accepted before it ships. Mycelium's modules (D2) are GPL
  code of a single author, which must be checked before any copy.

## Decision

1. **MVP scope (18.1).** The MVP has three locations: browser storage, a local folder and GitHub.
   OneDrive and Dropbox follow right after the MVP release, as a short Phase 4b with its own spec.
   They use the same provider interface and land before Phase 5. They are not part of the Phase 4
   gate.

2. **GitHub sign-in (18.2).**
   - The default is a "Mainspring" GitHub App, installed per repository. It signs in with the
     device flow. The app shows a code, and the user enters it at github.com/login/device.
   - The existing worker relays the two sign-in calls and refreshes tokens. The client secret lives
     only in the worker. The app's client id is public.
   - "Use a token instead" takes a fine-grained personal token. It needs no worker. Both options
     feed the same token store and transport.
   - A sign-in is kept on this device by default. A session-only option is offered.
   - The web flow with PKCE is for later.

3. **Transport (18.3).** The app calls the REST Git Data API from the page. Plan content never
   passes through a proxy, and no clone is made on a phone. A commit writes new blobs, a tree and a
   commit, then moves the branch with a ref update that is not forced.

   | Purpose | Endpoint |
   | --- | --- |
   | Who is signed in, installations, repositories | `GET /user`, `GET /user/installations`, `GET /user/installations/{id}/repositories`; with a token, `GET /user/repos` |
   | Head of the branch | `GET /repos/{o}/{r}/git/ref/heads/{branch}` |
   | The plan's files at a commit | `GET .../git/commits/{sha}`, `GET .../git/trees/{tree}?recursive=1`, `GET .../git/blobs/{sha}` |
   | Commit | `POST .../git/blobs`, `POST .../git/trees`, `POST .../git/commits`, `PATCH .../git/refs/heads/{branch}` with `force: false` |

   isomorphic-git can return later for GitLab or Bitbucket, behind the same interface.

4. **Mycelium (18.4).** Mycelium's modules are not copied wholesale. Task T2 first confirms that the
   sole author is the only author. After that, only pieces that fit the interfaces in section 6 of
   the spec are reused. The likely piece is the diff3 helpers. Any reused code is relicensed to
   GPL-2.0-or-later, as ADR-0001 requires.

5. **IndexedDB (18.5).** Mainspring does not use Dexie. It uses a small IndexedDB wrapper of its
   own. This closes the Dexie issue in ADR-0001.

6. **Saving per provider (18.6).**

   | Location | How a change is saved |
   | --- | --- |
   | Browser storage | Autosave, always. |
   | Local folder | Explicit Save (Ctrl or Cmd+S). An opt-in setting, "Save to the folder automatically", is offered. |
   | GitHub | Explicit Commit. A commit made offline is queued. |

7. **Samples and the first plan (18.7).** A sample opens unstored. Its first edit stores a copy named
   "Tutorial (copy)". The sample itself never changes. A new plan is stored at once. On start, the
   last plan opens.

8. **Undo after pulled or reloaded text (18.8).** Text that comes from a merge or from a reload
   becomes one undo step with a label: "Merged changes from GitHub" or "Reloaded from disk". Both
   undo stacks are kept. The change goes through `Workspace.apply`. This amends ADR-0008 #1.

9. **Schedule check strictness (18.9).**

   | Case | Result |
   | --- | --- |
   | A merge whose text does not schedule | Cannot be committed. There is no override. |
   | An ordinary commit of a plan with engine errors | Needs a confirmation that names the errors, "Commit anyway". |
   | Saving to the browser or to a folder | Never blocked. |

   The check is the app's own runner result for the exact text being committed. No schedule is
   computed outside the browser engine.

10. **History shape (18.10).** Queued commits stay separate commits, in order. A push is a
    fast-forward when one is possible. If the remote moved, the push is a merge commit with both
    parents. Mainspring never force-pushes.

11. **Invalid UTF-8 on save (18.11).** A file that has not changed is never written. A changed file
    that had invalid bytes asks first. The question is: "plan.tji will be saved with replacement
    characters where it had bytes that are not UTF-8". This amends ADR-0003 #1. Decoding is
    unchanged (ADR-0002 #13).

12. **Last-schedule cache (18.12).** Not in Phase 4. ADR-0015 is held for it, and that ADR decides it
    on its own.

16. **First-load bytes (18.16).** Phase 4 may add at most 3,000 bytes gzip to each first load. Every
    other module is lazy. The user is asked before any cap changes.

17. **Owners (18.17).** Storage, the providers, the service worker and the engine work belong to
    `engine-specialist`. Merge, hints and the sync core belong to `grammar-specialist`.

18. **Polish items 20, 21 and 22 (18.18).** Item 22 is done inside T14, because it uses the same
    files. Items 20 and 21 are fixed in the main session in wave 2, as bugs.

20. **Export (18.20).** Phase 4 adds two exports. The first copies the Gantt's visible range as a PNG
    in the current theme. The second is a CSV of tasks with these columns: id, name, start, end,
    effort, people, complete.

21. **Plan picker per folder (18.22).** When a folder, or a repository folder, holds several `.tjp`
    files, the app asks which plan to open. It remembers the choice for that location. The full plan
    picker stays in v1.

## Consequences

- **Plans in browser storage are only in this browser.** The app says so in plain words. On iOS the
  location line reads "Only in this browser", and GitHub is recommended. If the browser clears
  stored plans, the app says that it did and points to GitHub or Export (spec 9.4).
- **Mainspring keeps one small server.** The existing worker relays sign-in and token refresh only.
  Plan content never reaches it. The worker's host is chosen at T10.
- **Sign-in depends on the GitHub App and the worker.** Until the App is registered (T10, the user's
  work), the token option is the only sign-in. The worker must name the Pages origin in its allowed
  origins.
- **Tokens sit in IndexedDB.** Any script on the origin can read them. The protection is the content
  security policy (ADR-0020), no third-party scripts, short-lived app tokens and minimal scopes.
- **Sync carries plan files only.** Preferences are never synced. Each commit is conditional on its
  base, so a clash shows as a conflict and never as a forced overwrite.
- **Mainspring never deletes a file on a provider.** A commit only adds or changes files.
- **Tests use a fake GitHub.** CI never reaches the real GitHub. The real service is exercised only
  by the user's smoke run (18.15, ADR-0020).
- **ADR-0001's Dexie issue is closed.** Mycelium code enters only after the T2 audit.
- **Export adds the Gantt PNG and the task CSV (18.20).** The file exports of spec 7.2 (the `.tjp`
  or a `.zip`, by download or share sheet) are the fallback where a folder cannot be used.

## Amendment 2026-11-23: New file (user)

The app can create a `.tji` file and include it from the entry file (Phase 4 spec, section 21; tasks
T27a and T27b). The `include` line is a new edit-API intent, `addInclude`; creating the file is a
workspace operation and not an undo step. Nothing is deleted or renamed, in the app or on a provider:
after an undo the file stays, marked "Not included".
