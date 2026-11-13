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

## Decision

1. **A static Astro page with no client script.** The page ships HTML, CSS and inline SVG only.
   There is no framework island. No raster image is used: the product mocks are HTML and SVG, so
   they stay sharp, scale with the screen and follow light and dark. A test asserts that the page
   has no `<img>` and no `<script>`.
2. **Structure.** Header with a brass mark and navigation; hero; "How it works"; features
   (available, then coming); "Built on TaskJuggler"; a phone section; a closing call to action;
   a footer.
   - **Hero.** Eyebrow "Open source · For TaskJuggler"; the headline "Plain text plans that
     _keep time_." with an italic brass accent; a subhead; "Open the app" (primary, through
     `sitePath('app')`) and "How it works" (an anchor); four checkmark facts; and a tilted mock of
     the Split view, editor beside Gantt.
   - **How it works.** "The text is the plan. The chart is _a view_." A plan snippet beside its
     Gantt, with the line `effort 10d` and the Build bar highlighted, and three short steps.
   - **Features.** Six cards for what works today, then six dashed cards, each with a small brass
     "Coming" tag.
   - **Built on TaskJuggler.** Credit and a link to taskjuggler.org, what TaskJuggler schedules,
     the GPL notice, and a "movement" plate with the engine's specification.
   - **Phone.** A phone mock with the Gantt, a task card and the pill tab bar.
3. **Honesty rule.** A feature is shown as available only if it works in the app today. These are
   available: the real TaskJuggler 3.8.4 scheduler in the browser (identical to the native tool
   on the golden test plans); plain-text `.tjp` as the only source of truth; the editor with live
   scheduling, inline errors, completion and docs generated from TaskJuggler; the read-only
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
   page keeps its copy in `src/lib/landing-copy.ts`, so marketing text can change without
   touching the app's strings. The illustrated plan and its task names live in
   `src/lib/landing-sample.ts`.
6. **The mocks are illustrations of a plan the real engine scheduled.** The sample plan in the
   mocks (`relaunch.tjp`: Design, Build, Docs, Test, Launch) was scheduled in the browser engine
   on 2026-11-13 and the bars follow its dates: Build runs five working days for ten days of
   effort shared by two people, and Design, Build, Test and Launch are the critical path. The
   mocks follow the refined design (ADR-0009), which is ahead of the built app in places (the
   floating chips, the pill tab bar, the power-reserve gauge).
7. **Accessibility and performance.** One `h1`, `h2` per section, `h3` per card; landmarks;
   a skip link (from the base layout); each mock is one `role="img"` with a text description;
   decorative SVG is hidden from assistive technology; a 3 px focus ring; touch targets of at
   least 44 px; text pairs checked against WCAG 2.2 AA in both schemes; no horizontal scroll from
   320 px up; transitions use the motion tokens, which are zero under reduced motion. The page is
   about 80 KB of HTML (11 KB gzipped, most of it inline SVG) and 27 KB of CSS, plus the fonts
   the app already ships.
8. **Base path.** Links to the app and home use `sitePath()`. In-page links are anchors. External
   links are absolute `https://` URLs. The base-path scan and test cover it.
9. **Tests.** `src/lib/landing-copy.test.ts` and `src/lib/landing-art.test.ts` (unit);
   `tests/e2e/landing.spec.ts` (renders in light and dark, the app links under the base path,
   "Coming" tags, no sideways scroll, axe clean, focus ring, reduced motion);
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
