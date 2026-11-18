// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Toolbar primitive's tier rules (ADR-0016 #3). Owner: ui-builder. The three toolbars (the Gantt's
 * chips, the Workload and Lanes bar, the Calendar's bar) share these tiers; the CSS that applies them
 * is src/styles/toolbar.css (container and media queries cannot read a variable, so the widths are
 * written there too: `toolbar-tiers.test.ts` reads that file and fails if the two disagree). The
 * contract spec is tests/e2e/primitives/toolbar.spec.ts: it mounts each toolbar on /dev/primitives
 * and checks that its controls are on one row from 360 to 1600 px and that every control has declared
 * its narrow form. Consumers (their specs run on every change): gantt-add-task, gantt-phone-polish,
 * gantt-a11y, workload.spec, lanes.spec, calendar.spec, modes-layout.spec.
 *
 * A tier is a width at or below which something gives way. `narrow` and `tight` are the width of the
 * toolbar's own container (a Gantt in Split beside the editor is narrow on a wide screen); `phone` is
 * the viewport.
 */

/** The widths, in px: a tier applies at this width and under. */
export const TIERS = {
	/** The viewport of a phone. */
	phone: 599,
	/** A very narrow container: a pill that names a person needs the room of two controls. */
	tight: 699,
	/** A narrow container: Split beside the editor, a docked details column, a tablet. */
	narrow: 899,
} as const;

export type Tier = keyof typeof TIERS;

/**
 * What a control becomes when the room is short. Every control of a toolbar says which, with
 * `data-narrow` on it (or on its root), so that adding one cannot forget the question:
 * - `icon`: its label (`.lbl`) goes at the narrow tier and on a phone; it is its icon (its aria-label
 *   is its name), and 44 px on a finger;
 * - `icon-phone`: the same, on a phone only;
 * - `shrink`: its text is cut with an ellipsis on a phone (a select reads "Week (custom)" shorter);
 * - `fixed`: it keeps its size, and fits 360 px as it is;
 * - `own`: a component with tier rules of its own (the people picker, the filter, the view switcher);
 *   the one-row check still covers it.
 */
export const NARROW_FORMS = ['icon', 'icon-phone', 'shrink', 'fixed', 'own'] as const;
export type NarrowForm = (typeof NARROW_FORMS)[number];

export const isNarrowForm = (v: string | null | undefined): v is NarrowForm =>
	NARROW_FORMS.includes(v as NarrowForm);

/** The tiers in force for a toolbar `container` px wide on a `viewport` px wide screen. */
export function tiersAt(container: number, viewport: number): Tier[] {
	const on: Tier[] = [];
	if (viewport <= TIERS.phone) on.push('phone');
	if (container <= TIERS.tight) on.push('tight');
	if (container <= TIERS.narrow) on.push('narrow');
	return on;
}

/** The controls that have not declared a narrow form, by name (for the contract spec and a unit test). */
export function undeclared(controls: readonly { name: string; narrow: string | null }[]): string[] {
	return controls.filter((c) => !isNarrowForm(c.narrow)).map((c) => c.name);
}
