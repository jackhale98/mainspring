# ADR-0009: Visual direction: Mainspring (Paper layout, horological palette)

Status: accepted by the user, 2026-11-12 (Paper). Refined by the user, 2026-11-13 (Mainspring
palette).

## Context

The user wants Mainspring to feel like a premium, beautiful product. That applies to every view:
Gantt, resources, workload heatmap, calendar, plan health and the text editor.

Three full-app directions were mocked up on a design canvas:

- **A Graphite:** precise, quiet, dense.
- **B Paper:** warm, airy, calm.
- **C Midnight:** dark, vivid.

The user chose B Paper. The user also asked for both a light and a dark mode.

After choosing Paper, the user asked for a scheme tied to the product's name: brass, heat-blued
screws and the look of luxury watches. A fourth direction, D Mainspring, was mocked up in light
and dark, and chosen. On 2026-11-13 the user confirmed that Paper's layout and geometry stay, and
that the Mainspring palette replaces Paper's colours.

## Decision

1. **One design language for every view.** The same language covers light and dark. The app
   follows `prefers-color-scheme` and the app's theme switch.
2. **Layout and character come from Paper.** Warm grounds, generous spacing and pill-shaped bars
   stay. The colours come from the Mainspring palette below.
3. **Colour metaphor and roles.**
   - Enamel dial white is the ground for light mode. A midnight-blue dial is the ground for dark
     mode.
   - Heat-blued steel is the accent. It is used for the critical path, selection and primary
     actions.
   - Brass is used for normal work bars, milestones, the logo ring and the today line.
   - Ruby is used for over-allocation and errors.
   - Muted green is used for ok.
   - Brass is never used for body text in light mode. The exception is darker brass #9A7424,
     which may be used for small labels. Blued steel on light grounds is about 8:1.
4. **Type.** Inter is the interface font. JetBrains Mono is used for numbers, ids and durations,
   with tabular figures. Both fonts follow ADR-0005.
5. **Colour tokens.** Light and dark values are below.

   | Token | Light | Dark |
   | --- | --- | --- |
   | bg | #F8F5EE | #0D1117 |
   | canvas / surface | #FFFDF8 | #11151D / #151A24 |
   | surface2 | #F3EFE5 | #1C2230 |
   | border | #E6E0D2 | #2A3243 |
   | borderStrong | #CDC4B0 | #3D4659 |
   | text | #1C1A17 | #EEE7D7 |
   | muted | #625B4F | #A9A291 |
   | accent (blued steel) | #2346A0 | #7D9BE8 |
   | accentWash | #E7ECF8 | #1A2443 |
   | accentInk | #1C3A86 | #B3C5F4 |
   | brass (milestones, mark) | #B08D3C | #D2AE5C |
   | bar (brass tint) | #EFE6D1 | #2A2517 |
   | barProgress | #B08D3C | #C9A24D |
   | critical bar | #DCE4F5 | #1B2748 |
   | critical progress | #2346A0 | #7D9BE8 |
   | summary bar | #2E2A24 | #E8DEC6 |
   | today line | #9A7424 | #D2AE5C |
   | ok | #2F7D4F | #6FCF97 |
   | over (ruby) | #A3123A | #F0627E |
   | overSoft | #F7E3E8 | #3A1620 |
   | heat ramp | #F6F3EB, #E3E8F4, #BCCAEA, #8AA2DC, #3E5FB8 | #171C26, #1B2540, #223463, #2D4A8E, #6F8FE0 |
   | toast | #1E2338 on #FBF7EE text | #EEE7D7 with #11151D text |

6. **Geometry.**
   - Gantt row height is 40 and bar height is 18. The pill radius is 9.
   - Control radius is 10.
   - Panel radius is 16.
   - Heatmap cell radius is 10.
   - Sheet radius is 22 on phones.
   - Touch targets are at least 44 px on coarse pointers.
7. **Motion.** Sheets and panels animate in 150 to 200 ms. Bars animate to their new positions
   after a reschedule. Reduced motion is respected.
8. **Contrast.** All text pairs meet WCAG 2.2 AA (4.5:1). Colours that must be told apart also
   differ in lightness.

## Consequences

- `src/styles/tokens.css` is re-tokened to the values above. Every view, current and future, uses
  the tokens only. No view hard-codes a colour.
- The Phase 1 Text mode UI is restyled to match.
- The mockup canvas is a private claude.ai artifact. It is the visual reference for this ADR.
- Screenshots in `docs/phases/screenshots/` show the result.
- Graphite, Midnight and plain Paper colours are not pursued.
