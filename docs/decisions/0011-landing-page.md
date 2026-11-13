# ADR-0011: Public landing page

Status: accepted by the user, 2026-11-13 (the user asked for the page; that request is the
approval). Out-of-phase work, done during Phase 2. ADR-0010 is reserved for the fast-path outcome.

## Context

The site root, `src/pages/index.astro`, was a bare placeholder: a heading and a link to `/app`. The
public preview on GitHub Pages (ADR-0006) opens on it. The user wants it to be an elegant
marketing page that stands next to their other product sites (tessera-engineering.com,
my-celium.org, ourplanner.app), in Mainspring's own design language (ADR-0009), and honest: it
may show as available only what works today.

What those sites share, and what the page takes from them: a large confident display headline
(Mycelium sets it in a serif with italic accent words), a small uppercase eyebrow, a plain
subhead, a dark primary pill button and an outlined secondary one, a row of small checkmark facts,
a floating product mock with a soft shadow (sometimes tilted), warm grounds with faint colour
washes or a grid, feature sections with clear headings, and an open-source footer.

## Amendment, 2026-11-13: audience and messaging

The user reviewed the first page and said it explained poorly what is good about the app,
especially to people who do not know TaskJuggler. The audience is technical project managers and
engineering leads, not TaskJuggler users. The draw is to build a plan with visual tools and get a
plain-text file that can be version controlled, with no syntax to learn. TaskJuggler is the proof
that the scheduling is serious; it is not a prerequisite. The page was restructured around that
(the structure in decision 2 is the reworked one). Visual editing is still not built: the page
leads with the aim and says plainly that it is the next step.

## Decision

1. **A static Astro page with no client script.** The page ships HTML, CSS and inline SVG only.
   There is no framework island. No raster image is used: the product mocks are HTML and SVG, so
   they stay sharp, scale with the screen and follow light and dark. A test asserts that the page
   has no `<img>` and no `<script>`.
2. **Structure** (reworked on 2026-11-13, see the amendment above). Header with a brass mark and
   navigation; hero; "Why your plan belongs in your repository"; "No syntax to learn"; "A
   scheduler that does the hard part"; who it is for; features (available, then coming); a phone
   section; a short FAQ; "Built on TaskJuggler"; a closing call to action; a footer.
   - **Hero.** Eyebrow "Project planning for technical teams"; the headline "Plan visually.
     _Version it like code._" with an italic brass accent; the subhead; "Open the app" (primary,
     through `sitePath('app')`) and "Why plain text" (an anchor); four checkmark facts; the honest
     line "Early preview: today you edit the text and see the Gantt. Drag-and-drop editing is
     coming next."; and a tilted mock of the Split view: the plain-text plan on the left and its
     Gantt on the right, for the same four tasks, with Design selected in both (blued-steel edge)
     and the edited `effort` line in brass.
   - **Why your plan belongs in your repository.** Five benefits (review like code, history,
     branch a what-if, no lock-in, plain text outlives any tool) beside a mock pull request that
     changes `effort 5d` to `effort 8d`, with the note "Finish moves Jan 6 → Jan 9". The note is a
     schedule diff, which is a planned feature, so it carries a "Coming" tag.
   - **No syntax to learn.** A drag on the Gantt becomes one small text change. Visual editing
     is not built, so the Gantt half carries a "Coming" tag, the drag points are tagged, and the
     page says "Visual editing is the next step. Today you edit the text and the Gantt follows."
   - **A scheduler that does the hard part.** Four plain-language cards with small drawings:
     effort shared by people, nobody double-booked, holidays and leave, the critical path; then
     the credit to TaskJuggler.
   - **Who it is for.** Engineering leads, technical project managers, hardware and systems teams.
   - **Features.** Six cards for what works today, then six dashed cards, each with a small brass
     "Coming" tag.
   - **Phone.** A phone mock with the Gantt, a task card and the pill tab bar.
   - **FAQ.** Do I need to know TaskJuggler (no), where do my plans live (in the browser tab today),
     is it free (yes), can I use my existing TaskJuggler files (yes, paste them in today).
   - **Built on TaskJuggler.** Kept short: the credit, a link to taskjuggler.org, the GPL notice
     and a "movement" plate with the engine's specification.
3. **Honesty rule.** A feature is shown as available only if it works in the app today. These are
   available: the real TaskJuggler 3.8.4 scheduler in the browser (identical to the native tool
   on the golden test plans); plain-text `.tjp` as the only source of truth; the editor with live
   scheduling, inline errors, completion and docs generated from TaskJuggler (visual editing is
   not available and is never described as if it were); the read-only
   Gantt beside the text; light and dark; phone, tablet and desktop layouts; no sign-up, open
   source (GPL-2.0-or-later), local in the browser. These are shown with a "Coming" tag, from
   `docs/BUILD_PLAN.md`: visual editing; workload heatmap and resources; plan health checks;
   saving to a folder and GitHub sync with a schedule diff; install as an app and work offline;
   scenarios and tracking. The hero does not say "works offline" or "installable". The page says
   plainly that changes stay in the browser tab until saving arrives. It has no statistics and no
   testimonials. `src/lib/landing-copy.test.ts` checks the list of coming features, that no
   available card mentions a planned feature, and that the copy has no hype words.
4. **Design language (ADR-0009).**
   - Enamel and brass carry the page. The ground is enamel (`#F8F5EE`) in light mode and the
     midnight dial (`#0D1117`) in dark mode, following `prefers-color-scheme` like the app.
   - Blued steel appears only as a thin accent: the focus ring, the selected-row edge and the
     keyword colour in code.
   - Ruby marks only the critical path in the mocks (bars, links and the "Critical" tag), per the
     pending human-factors table. The app's own critical bars are still blue until the restyle
     pass in ADR-0009 lands; the mocks show the intended result.
   - Type: Instrument Serif for display with italic accents, Inter for text, JetBrains Mono for
     code, all self-hosted (ADR-0005).
   - Watchmaker details, sparingly: the brass coiled-mainspring mark; one faint guilloché
     (engine-turned) rosette behind the hero; the brass crown on the today line; the
     power-reserve gauge on the phone task card; the "movement" plate.
   - Colours come from `src/styles/tokens.css`. `src/styles/landing.css` adds `--lp-*` aliases to
     the existing Gantt tokens and the few values tokens.css does not have (page ground, ink,
     ruby, the brass text colour `#7F5F18` / `#D2AE5C`, which meets 4.5:1 for small labels where
     ADR-0009's `#9A7424` is 3.9:1 on the page ground).
5. **Copy in its own file.** The app keeps user-facing copy in `src/lib/strings.ts`. The landing
   page keeps its copy in `src/lib/landing-copy.ts` and `landing-copy-more.ts`, so marketing text can change without
   touching the app's strings. The illustrated plan and its task names live in
   `src/lib/landing-sample.ts`.
6. **The mocks are illustrations of a plan the real engine scheduled.** The sample plan in the
   mocks (`plan.tjp`: Design, Build, Docs, Test, Launch, starting Mon 2025-12-22) was scheduled in
   the browser engine on 2026-11-13, and the bars follow its dates. With `effort 5d` on Design
   the Launch milestone falls on Jan 6; with `effort 8d` it falls on Jan 9, which is the
   pull-request note. Build is ten days of effort shared by two people, five working days, and
   Design, Build, Test and Launch are the critical path. The year-end dates are chosen so that
   Jan 6 and Jan 9 are a Tuesday and a Friday, three working days apart. The mocks follow the
   refined design (ADR-0009), which is ahead of the built app in places (the floating chips, the
   pill tab bar, the power-reserve gauge). The mode switch in the hero shows Split, which the app
   has today. The drag handle and "8d" label in "No syntax to learn" show a feature that is not
   built, and are tagged "Coming".
7. **Accessibility and performance.** One `h1`, `h2` per section, `h3` per card; landmarks;
   a skip link (from the base layout); each mock is one `role="img"` with a text description;
   decorative SVG is hidden from assistive technology; a 3 px focus ring; touch targets of at
   least 44 px; text pairs checked against WCAG 2.2 AA in both schemes; no horizontal scroll from
   320 px up; transitions use the motion tokens, which are zero under reduced motion. The page is
   about 96 KB of HTML (13 KB gzipped, most of it inline SVG) and 34 KB of CSS, plus the fonts
   the app already ships.
8. **Base path.** Links to the app and home use `sitePath()`. In-page links are anchors. External
   links are absolute `https://` URLs. The base-path scan and test cover it.
9. **Tests.** `src/lib/landing-copy.test.ts` and `src/lib/landing-art.test.ts` (unit; the copy
   test pins the hero line about drag-and-drop being next, that every drag-related point is
   tagged, that the six coming features stay tagged and that the pull-request story is
   consistent);
   `tests/e2e/landing.spec.ts` (renders in light and dark, the app links under the base path,
   "Coming" tags, the hero does not claim visual editing, no sideways scroll, axe clean, focus
   ring, reduced motion);
   `tests/base-path/pages.spec.ts` now checks every root-relative link on the home page and
   follows the first "Open the app" link, since the page offers it twice.

## Consequences

- When a feature ships, move its card from `coming` to `available` in `landing-copy.ts` and update
  the test that lists the coming features. The page must never run ahead of the app.
- The headline, mocks and colours are a design choice the user can change in one pass:
  copy in `landing-copy.ts`, materials in `landing.css`, drawings in `components/landing/`.
- The page says "Mainspring is an independent project, not an official TaskJuggler release" and
  credits TaskJuggler. The user should confirm that wording.
- The OpenSSL issue in ADR-0001 still blocks a real release; this page does not change it.
- The ruby critical path in the mocks is ahead of the app until ADR-0009's pending restyle pass.
