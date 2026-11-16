# Logo exploration, November 2026

Two hand-built logo directions for the user to choose from. Nothing here changes the shipped app:
the app's `Mark` components, `public/favicon.svg` and `public/icons/` are untouched. Start with
`mockups/comparison-light.png` and `mockups/comparison-dark.png`.

Colours map to ADR-0009 tokens. Light: band navy `#1C2A55` (the active-mode pill), gold brass
`#B08D3C`, tile `#ECE7DC`. Dark: band `#B3C5F4` (accentInk, a light heat-blued steel), gold brass
`#D2AE5C`, tile `#11151D`. Swapping the dark band to ivory `#EEE7D7` is a one-line change in
`tools/marks.mjs` (`PALETTE`).

## Version A, Flow (`a-flow-*`)

A refined redraw of the reference. One S-shaped band (two hooks of equal radius joined by their
internal tangent, point symmetric about the centre) crosses a ring that is split into two navy arcs
and two gold arcs. Everything is one stroke width, one gap (about a quarter of the band) and radial
end cuts; where a ring arc meets the band, the band's halo (its width plus a gap on each side) is
cut out of it, so every gap is the same by construction. At small sizes the full form is
unusable (the gap is under 1 px at 32 px), so the small form is the band alone, 18% of the width
thick, with no gold and no gaps: at 16 px it is a 3 px stroke and reads as a bold "S" ribbon, crisp
but generic (close to a tilde). It still reads as infinity or "sync" more than as a mainspring.

## Version B, Spring (`b-spring-*`)

The same S band, slimmer, with its left end winding inward into a coil: the hook, then three half-turn
semicircles (the clock-spring construction: each half turn is a semicircle whose radius is half a
pitch smaller, so the coil pitch equals band plus gap everywhere). Two short gold strips sit outside
the loops, centred on the hook's end cut and rotated half a turn from each other. The mainspring
reading is immediate at 64 px and above. The small form drops the gold and keeps one turn of coil,
with a thicker band (10% of the width) and a gap of about half a band: it holds at 32 px (a clear
curl) but at 16 px the stroke is 1.6 px and the curl is a smudge of about 4 px, so it reads as a
swirl rather than as a coil.

## Files

- `svg/`: per version, `full-light`, `full-dark`, `small-light`, `small-dark` (the small marks are
  for 16 to 32 px), `icon-light`, `icon-dark` (the tile used for the PNG icons) and `favicon.svg`
  (the small form, recoloured by `prefers-color-scheme`). All are plain SVG with no external
  references; the full forms use one internal `<mask>` for the gap cut. Total 9 KB for 14 files.
  Before shipping, bake the mask into outline paths.
- `png/`: per version, `icon-maskable-512` and `-192` (mark at 60% of the tile width, every point
  inside the 80% safe circle), `apple-touch-180` (72%), `favicon-32` and `favicon-16`; the `-dark`
  files are the dark theme. `current-favicon-*` is the shipped favicon, for the comparison.
- `mockups/`
  - `comparison-light.png`, `comparison-dark.png`: rows Current, A, B; columns full mark, 32 px and
    16 px at actual size and 4x, app icon, top bar.
  - `{current,a,b}-{light,dark}-desktop-topbar.png`, `-desktop-landing.png`: 1440 x 900 at 2x.
  - `{current,a,b}-{light,dark}-phone-topbar.png`, `-phone-landing.png`: Pixel 7.
  - `tabs-favicon.png`: favicon at 16 and 32 px on light and dark tab strips.
  - `homescreen-icons.png`: the 180/192 icon on light and dark wallpapers with placeholder icons.
  - Real-app shots came from a local build with the mark components swapped (a temporary edit,
    reverted). In the top bar the wide small marks were shown in a slot about 1.35 times wider
    than the shipped 26 px square; shipping a wide mark would mean that small layout change.
- `tools/`: `geom.mjs` (arc construction), `marks.mjs` (the two marks and the palette), `build.mjs`
  (SVG and icon PNGs), `shoot.mjs`, `crop.py`, `compose.mjs` (mockups).

## Contrast of the band (WCAG 1.4.11, 3:1 for graphics)

Both versions use the same band colour, so the numbers are the same for A and B.

| Theme | Band | vs bg | vs canvas (top bar) | vs surface | Gold | vs bg | vs canvas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Light | `#1C2A55` | 12.76 | 11.27 | 13.66 | `#B08D3C` | 2.87 | 2.53 |
| Dark | `#B3C5F4` | 11.00 | 11.46 | 10.63 | `#D2AE5C` | 8.97 | 9.34 |

(bg `#F8F5EE` / `#0D1117`, canvas `#ECE7DC` / `#080B10`, surface `#FFFDF8` / `#11151D`.) The band
passes everywhere. Light-theme gold is under 3:1; it is decorative, and the ADR-0009 dark brass
`#9A7424` gives 3.94 on bg and 3.48 on canvas if it must pass.
