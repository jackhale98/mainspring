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

## Note, 2026-11-13: role mapping after the first Gantt review

The light bar fill (#EFE6D1) and the light link colour (#CBBF9E) are under 3:1 against the
canvas, so bars need an outline (WCAG 1.4.11). Measured in the Gantt review:

- Bar outlines and dependency links use dark brass #9A7424 in light mode (4.2:1 on the canvas,
  3.8:1 on the selected row) and brass #C9A24D in dark mode, so links read as brass in both.
- Row selection uses accentWash (#E7ECF8 / #1A2443), not a separate tint.
- Grid lines use the palette's border greys.
- The dimmed last-good state fades fills and lines only; labels keep at least 4.5:1.

## Refinement, 2026-11-13: the Mainspring refined design language

### Context

The user reviewed a refined mockup on the design canvas, row E, "Mainspring refined". The user said
it is better than the flat version. The refined language is now the design language for every view.
It keeps the Paper layout and the Mainspring palette. It adds an app shell, floating controls,
a type system, icons, materials and a few signature details. The values below come from the
THEMES objects in the refined mockups, for light and dark mode.

### Decision

1. **App shell.**
   - The canvas is a recessed warm ground. It is #ECE7DC in light mode and #080B10 in dark mode.
   - The task list, timeline and inspector are separate floating panels. Each has a 16 px radius.
     Gaps between panels are 8 px. Panels have soft, layered shadows. Panel surfaces are #FFFDF8
     in light mode and #11151D in dark mode.
   - The top bar sits on the canvas, not in a panel. From left to right it holds:
     - the brand mark and the wordmark;
     - a plan chip;
     - undo and redo icon buttons;
     - a centred mode switch with Text, Split and Visual, each with an icon;
     - an engine status pill with a green halo dot;
     - a theme toggle.
   - The active mode is a dark pill. It is #1C2A55 with ivory text in light mode. In dark mode it is
     ivory (#EEE7D7) with dark ink.

2. **Floating controls.**
   - Controls over the chart are glass pill chips. They include zoom, Today and a Critical path
     toggle. Light glass is rgba(255,253,248,0.92). Dark glass is rgba(17,21,29,0.9).
   - A floating tool dock holds icon-and-label buttons: Task, Milestone, Link, Indent, Assign and
     More.
   - The toast sits in a corner. Its Undo action is brass in light mode (#E3C47E on #1A2240) and
     blued steel in dark mode (#1E3C8C on #EEE7D7).
   - On phones:
     - a floating pill tab bar, inset from the edges;
     - chip filters;
     - a rounded chart card;
     - a task card above the tab bar, with the power-reserve gauge.

3. **Type.**
   - Instrument Serif is the display face. It is used for the wordmark, month names, inspector
     task titles and large numbers. Month names carry an italic, muted year.
   - Inter is the interface font.
   - JetBrains Mono is used for durations and ids.
   - Small section labels are uppercase, 10.5 px, with 0.08em letter spacing.

4. **Iconography.** Every control with a label uses a Lucide-style stroke icon at a 1.8 px stroke.
   Lucide is ISC licensed, which is GPL-compatible.

5. **Materials.**
   - Normal work bars are brushed-brass pills. They are 22 px high with an 11 px radius. The fill
     is a vertical gradient. Light mode runs from #F7EFDC to #EADDBD. Dark mode runs from #3B3322
     to #2A2417. Each bar has an inset highlight and a soft shadow.
   - Critical-path bars use a heat-blued steel gradient. Light mode runs from #3A60C2 to #1E3C8C.
     Dark mode runs from #5F82E0 to #2D4CA4. Their text is white.
   - Milestones are brass jewel diamonds with a highlight gradient. The brass is #B08D3C in light
     mode and #D2AE5C in dark mode. The highlight is #F1D99A in light mode and #F6E3AE in dark mode.
   - Summary bars are a thin 3 px stem with end caps. Their ink is a muted group colour: #7A7262 in
     light mode and #B9AF98 in dark mode.
   - Links are brass. On the critical path they are blued steel. Links have rounded elbows.
     Light mode link colours are #B39A62 (brass) and #2346A0 (critical). Dark mode link colours are
     #8C7A4C (brass) and #7D9BE8 (critical).

6. **Signature details.** These are used sparingly.
   - The brand mark is a brass coiled mainspring spiral.
   - A power-reserve gauge shows % complete. It is a brass tick arc with a blued-steel progress arc
     and a needle. It appears in the inspector and on the phone task card.
   - A small brass crown knob tops the today line. Its top is #E3C47E in light mode and #F1D99A in
     dark mode.
   - Guilloché patterns appear in empty states only.

### Consequences

- The app shell (task T14) and the app-wide restyle build to this language.
- The Gantt painters use these materials through tokens. No view hard-codes a value.
- Fonts are added through @fontsource packages on the licence allow-list. Instrument Serif is OFL
  and is allowed by ADR-0005.
- Icons are inline SVG paths, or a Lucide package if it is ISC.
- Where the refined mockup and the earlier sections differ, these values apply (they supersede the
  earlier token table and Geometry section):
  - Canvas: the app ground is the recessed #ECE7DC (light) / #080B10 (dark). Panels and cards
    are the earlier bg and surface values (#FFFDF8 / #11151D).
  - Links: the contrast note wins. Normal links are #9A7424 (light) and #C9A24D (dark); the
    mockup's lighter #B39A62 and #8C7A4C are not used.
  - Bar geometry: 22 px bars with an 11 px radius in 40 px rows on every pointer. The Gantt
    task-list rows match.
  - Bar outlines: brass bars keep a 1 px outline in the link colour (#9A7424 / #C9A24D) so the
    bar edge meets WCAG 1.4.11. The blued-steel critical bars already exceed 3:1 and need none.

## Pending refinement, 2026-11-13: blued steel as an accent only

The user asked for less blue, as a later change that must not delay the next deploy. On a real
watch, heat-blued steel is an accent (the hands, a few screws), not a surface. The intent:

- Enamel and brass carry the interface: grounds, panels, bars, controls and selection.
- Blued steel appears only as thin, precise accents. Candidates: the critical-path links and a
  fine blued edge or hand-like marker on critical bars instead of a solid blue fill, the progress
  needle and arc, the focus ring, and the active-mode indicator.
- Primary buttons, active tabs, selection washes and filled chips move from blue to brass or
  enamel tones.

This will be applied in one restyle pass after the Gantt and the app frame merge, and recorded
here with the final values.
