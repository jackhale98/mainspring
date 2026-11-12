# ADR-0009: Visual direction B, Paper

Status: accepted by the user, 2026-11-12.

## Context

The user wants Mainspring to feel like a premium, beautiful product. That applies to every view:
Gantt, resources, workload heatmap, calendar, plan health and the text editor.

Three full-app directions were mocked up on a design canvas:

- **A Graphite:** precise, quiet, dense.
- **B Paper:** warm, airy, calm.
- **C Midnight:** dark, vivid.

The user chose B Paper. The user also asked for both a light and a dark mode.

## Decision

1. **One design language for every view.** The same language covers light and dark. The app
   follows `prefers-color-scheme` and the app's theme switch.
2. **Character.**
   - Warm off-white grounds.
   - Generous spacing.
   - Pill-shaped bars.
   - Soft shadows.
   - A teal accent. It is used only for the critical path, the selection and primary actions.
   - Semantic colours are kept apart from the accent. Over-allocated and warning use burnt orange.
     Ok uses green.
3. **Type.** Inter is the interface font. JetBrains Mono is used for numbers, ids and durations,
   with tabular figures. Both fonts follow ADR-0005.
4. **Colour tokens.** Light and dark values are below.

   | Token | Light | Dark |
   | --- | --- | --- |
   | bg | #F7F5F0 | #161411 |
   | canvas | #FFFEFB | #1A1815 |
   | surface | #FFFEFB | #1E1B17 |
   | surface2 | #F4F1EA | #26231E |
   | border | #E8E3D9 | #34302A |
   | borderStrong | #CFC7B8 | #4C463C |
   | text | #1F1C17 | #F2EDE3 |
   | muted | #655E54 | #ABA293 |
   | accent | #0E7C70 | #38B2A2 |
   | accentWash | #E3F2EF | #173330 |
   | accentInk | #0A5C53 | #8FDCCF |
   | bar | #ECE6DA | #2F2B24 |
   | barProgress | #A89C86 | #8E8475 |
   | critical bar | #CFE7E2 | #1C3C37 |
   | critical progress | #0E7C70 | #38B2A2 |
   | summary bar | #3B362E | #E6DFD2 |
   | today line | #B45309 | #E39A4F |
   | ok | #15803D | #5BD08A |
   | over | #C2410C | #EE8A5C |
   | overSoft | #FDE8DC | #3A2219 |
   | heat ramp | #F6F3EC, #DDEEEA, #B4DBD3, #76BCAF, #2E8F81 | #211E1A, #173632, #1A4D45, #1F6C60, #3AA493 |

5. **Geometry.**
   - Gantt row height is 40 and bar height is 18. The pill radius is 9.
   - Control radius is 10.
   - Panel radius is 16.
   - Heatmap cell radius is 10.
   - Sheet radius is 22 on phones.
   - Touch targets are at least 44 px on coarse pointers.
6. **Motion.** Sheets and panels animate in 150 to 200 ms. Bars animate to their new positions
   after a reschedule. Reduced motion is respected.
7. **Contrast.** All text pairs meet WCAG 2.2 AA (4.5:1). Colours that must be told apart also
   differ in lightness.

## Consequences

- `src/styles/tokens.css` is re-tokened to the values above. Every view, current and future, uses
  the tokens only. No view hard-codes a colour.
- The Phase 1 Text mode UI is restyled to match.
- The mockup canvas is a private claude.ai artifact. It is the visual reference for this ADR.
- Screenshots in `docs/phases/screenshots/` show the result.
- Graphite and Midnight are not pursued.
