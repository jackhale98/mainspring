# Phase 2 polish list

Small visual and behaviour fixes found while reviewing the live build. Each one is small: it is
fixed in the main session or folded into the task that owns the code, and each fix ships with a
phone and a desktop screenshot. An item is struck through when its fix merges.

| # | Found | Item | Where | Suggested fix |
| --- | --- | --- | --- | --- |
| 1 | User, 2026-11-13 | ~~**Dependency arrows on a straight drop look misaligned.** When a link drops vertically to a task whose start is at, or just right of, the line's x, there is almost no horizontal run before the arrowhead. The right-pointing head then sits beside the vertical line instead of at the end of a segment. Seen on the proof-of-concept plan: the arrows into "Sign in with a GitHub App" and into the task after it.~~ **Fixed:** every route keeps a straight run of the arrow head plus 4 px into its target (`route.ts`, `approach`); nearer than that it goes round and steps in from the left. Pictures: `screenshots/phase-2/polish-1-arrows-*` (`-before` pairs). | `src/lib/gantt/route.ts`, link painter | Give every finish-to-start route a minimum horizontal approach: the arrowhead length plus 4 px. When the gap is shorter, use the go-round shape: step left of the target, then in. Check against the Fedora and gantt-500 plans. |
| 2 | Screenshot review | ~~**The today and status-date lines cross bar labels.** Most visible in dark mode ("Item 9" and "Item 10" on gantt-500).~~ **Fixed:** the today and status-date lines leave a gap where they cross a name (a halo was not possible: the lines are on the overlay layer above the bars, so the line gives way instead; same code in both themes). Pictures: `polish-2-marker-labels-*`. | Overlay or bars painter | Paint the marker lines under the label layer, or give labels a ground-coloured halo. |
| 3 | Screenshot review | ~~**Labels of short bars sit outside the bar and can collide** with links and the today line.~~ **Fixed:** the layout reserves each name's run (`labels.ts`, `GanttLayout.labels`, one rule shared with the painter); hit testing leaves links out of it; link legs step off the names of the rows they pass. Not done: a leg that has no room to step off still runs through a name (it is then drawn over by the text), and the float tail is not reserved. | Bars painter, layout | Reserve the label run in hit testing and layout, and route links around it where possible. |
| 4 | T14 review (6) | ~~**A sliver of the ending month's label ("l 2013") shows by the task column** as the next month pushes it out.~~ **Fixed:** the month label fades as the room left in its cell falls below its width and is gone at half of it (`fade.ts`, `TimeHeader.svelte`). The fade follows the scroll event, so on a fast fling it can trail the compositor by a frame. Pictures: `polish-4-month-sliver-*` (four scroll offsets, `-before` pairs). | `src/components/gantt/TimeHeader.svelte` | Fade the label out as its cell's remaining width falls below the label width. |
| 5 | T14 report | ~~**The critical bar's edge is drawn in the critical colour,** so on a ruby fill it barely shows. The finish post carries the cue for now.~~ **Fixed:** a new `--color-gantt-critical-edge` token in both themes (light `#fbc9d5`, dark `#ffdde4`): at least 3.25:1 against both ends of the ruby fill, and 2.5:1 against the done part's tinted fill, for normal vision, protanopia and deuteranopia (the measured minima are 3.48:1 and 2.63:1, in the light theme; asserted in `tests/ci/palette.test.ts` and shown in the simulated pictures `polish-5-critical-edge-protanopia-*` and `-deuteranopia-*`). | Bars painter | A lighter or darker ruby edge. Check under protanopia and deuteranopia. |
| 6 | T14 review (7) | ~~**On a phone, the hidden Plan tab's outline stays mounted.** That is about 2,800 extra DOM nodes on gantt-500.~~ **Fixed:** the phone's Plan tab is unmounted while another tab shows (the hidden tree rendered every row, its viewport being 0); its scroll and selection are kept in `planViews` and put back on return, the collapse state is the app's. gantt-500 on a Pixel 7: 3308 DOM nodes before, 488 after (`polish-6-node-counts-*.json`). | `App.svelte`, outline | Unmount, or virtualise, while hidden. Measure in T22. |
| 7 | T14 review | ~~**`model.todayMin` is now always null.** The overlay and header take `todayMin` from `todayOf`, so a future caller that reads the model's field gets nothing.~~ **Fixed:** the field and `nowMs` are removed from the model; the overlay, the header and `markerState` take the clock from `todayOf`. | `src/lib/gantt/model.ts` | Remove the field, or fill it from `todayOf`. |
| 8 | User, 2026-11-13 | **Use the phone screen better.** The chart should get more of the screen. | Phone layout (`App.svelte`, `TopBar.svelte`, `GanttToolbar.svelte`) | Task details in a slide-up bottom sheet: already specified in T17 (half height, drag to full, 44 px steppers). Beyond that: a slimmer top bar, chips that collapse into one control, a narrower name column with a swipe to widen it, and the "Changes stay in this tab" note folded into the status line. Mock it on the design canvas first. |
| 9 | T5 review (8) | ~~**On a phone, the "whole path before the status date" pill covers the bottom row.** The list still scrolls, and the pill ignores pointer events.~~ **Fixed:** the Gantt reserves the pill's measured height (and its gap) as padding at the bottom of the scroller while the pill shows, on a phone only. Test: `tests/e2e/gantt-phone-polish.spec.ts`. | Phone task pill | Reserve the pill's height at the bottom of the scroller while the pill shows. |
| 10 | User, 2026-11-13 | ~~**Let the user resize the table against the chart.** A draggable divider between the task table and the Gantt, like the text Split view. The table keeps natural column widths and scrolls sideways in its own pane; no automatic column hiding.~~ **Fixed:** the Visual view has a draggable divider between the task table and the chart (`SplitDivider.svelte`, `table.ts`, `mode.svelte.ts`); every column is drawn at its natural width, the table scrolls inside its pane behind the frozen Task column and a focused cell is scrolled into view (`columns.ts` no longer hides columns); one shared vertical scroll; the pane is never narrower than the name column and the widest other column, and the separator reports that limit; dragging it repaints no canvas and builds no layout (no long task on gantt-500, `tests/e2e/gantt-table-divider.spec.ts`); the position is stored per sample; the phone keeps the single name column. Tests: `tests/e2e/gantt-table-divider.spec.ts`. Pictures: `polish-10-*`. | `Gantt.svelte`, `OutlineGrid.svelte`, `columns.ts`, the split divider component | ADR-0008 amendment (2026-11-13). Reuse the text Split view's divider (keyboard, 44 px target). Task column frozen at the table's left; one shared vertical scroll; position stored per sample. Phone unchanged. |

## Item 1 revisited (user, 2026-11-14): how links reach a task below

"The arrows on the Gantt for tasks directly below predecessors still don't look great." The
rule of item 1 (a run of the arrow head plus 4 px into every target, else go round) made a task
directly below its predecessor take the S-jog, and links into a bar, a bracket or a diamond
below the Spike row ended in down-pointing heads beside the target instead of on it. Reworked
to the MS Project / OmniPlan style (`route.ts`, `layout.ts`, `labels.ts`, `paint/links.ts`,
`paint/overlay.ts`; the 121-position sweep in `route.test.ts` asserts the shapes):

- **Finish to start, the successor starts at or after the end** (half a pixel of tolerance):
  along the predecessor's mid-height to 8 px inside the successor's start (the middle of a bar
  shorter than 16 px, the vertex of a diamond, a hair inside a bracket's cap), then straight down
  or up onto the successor's top or bottom edge. The head is on that edge (a bracket seen from
  below: under its top bar). No jog, adjacent rows included.
- **Where that run would cross what stands beside the predecessor** (its name beside the bar, or
  its avatars; `GanttLayout.beside`, `labels.ts besideStarts`), the line leaves by the bar's
  lower or upper edge near its end (a milestone: its tip), runs along the row boundary and drops
  onto the successor in the same place. A line never runs through the names or avatars of its
  own endpoints.
- **Finish to start, the successor starts before the end:** the go-round, as before: a short
  stub, down into the gap, back past the start, down, then a run into the start with a
  right-pointing head. Start to start, finish to finish and start to finish keep their C and
  go-round shapes, and end on the edge they point at.
- A start to start or start to finish link out of a milestone is routed as a finish to start
  one (a milestone's start and end are one instant).
- **Heads touch:** `--gantt-link-gap` is now 0, so the tip is on the edge, not 2 px short.
- **Under the bars:** the base layer already painted links before bars; a test now pins it. The
  hovered or selected link is on the overlay above the bars, so the bars of its rows are cut out
  of its stroke: it is the same line, not one struck through a bar. A link behind a bar is hit
  where it shows (the bar wins inside its hit area), pinned in `hit.test.ts`.
- Step-off of a vertical leg from names beside the bars of the rows between is kept: the leg
  slides along the successor's edge (inside the bar) to clear them.

Pictures: `screenshots/phase-2/links-<sample>-<device>-<scheme>[-scrolled][-before].png`
(upstream-tutorial, gantt-manipulation, upstream-fedora-20, gantt-500; desktop at 2x and Pixel 7;
light and dark), from `tests/e2e/links-screenshots.spec.ts` with `SCREENSHOTS=1`.
| 11 | User, 2026-11-14 | **Add predecessors and successors from the task details,** not only by drawing on the chart. "Waits for" and "Followed by" get an Add button that opens a searchable task picker (by name or id). | `src/components/inspector/**` | Reuse the `addDepends` intent through the dispatcher (same refusals: loops, self, ancestors; same toast and undo). The picker is a combobox with keyboard support and 44 px rows on a phone. |
| 12 | T22, 2026-11-14 | **Phone scroll cost.** Under Pixel 7 emulation (4x CPU, software raster) the 500-task scroll is about 64% on time; about 55% of main-thread time is Chromium style, layout and paint, about 13% script. | `Timeline.svelte:126`, `TimeHeader.svelte:48`, treegrid on coarse pointers | Drop the `getClientRects().length === 0` visibility checks that force layout every paint; mount fewer treegrid rows on a coarse pointer; `contain: strict` on the rows' container; check the canvases redraw only past the overscan. Re-measure with `gantt-perf.spec.ts` (`E2E_PERF=1`). Confirm on a real phone in Phase 6; if a device also fails, 8.1's OffscreenCanvas ADR. |
