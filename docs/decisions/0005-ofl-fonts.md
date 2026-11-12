# ADR-0005: OFL-1.1 fonts

Status: accepted by the user, 2026-11-12.

## Context

The build plan's design system uses Inter for the UI and JetBrains Mono for source and ids,
self-hosted. Both are licensed under the SIL Open Font License 1.1, which the license check
(`scripts/ci/licenses.mjs`) rejects because it is not on the GPL-2.0-compatible code list.

## Decision

OFL-1.1 is allowed for font files only (packages that ship font data, such as
`@fontsource-variable/*`), not for code. Fonts are separate data files that the app loads; they
are not linked into Mainspring's code, so the combination stays GPL-2.0. The fonts' license texts
ship with the site's notices.

## Consequences

- Text mode self-hosts Inter and JetBrains Mono as the design system says.
- The license check accepts OFL-1.1 only for an explicit list of font packages.
