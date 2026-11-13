// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Focus and scroll helpers between the inspector and the Gantt's task list (phase-2.md 10.2, 10.3).
 * The treegrid mounts only the rows near the viewport, so a row that is not mounted is not found,
 * and the helpers then do nothing.
 */

const rowOf = (root: ParentNode, key: string): HTMLElement | null =>
	root.querySelector<HTMLElement>(`[role="treegrid"] [role="row"][data-key="${CSS.escape(key)}"]`);

/** Puts the keyboard focus back on a task's row in the list; false when it is not mounted. */
export function focusRow(key: string | null, root: ParentNode = document): boolean {
	const row = key === null ? null : rowOf(root, key);
	if (!row) return false;
	row.focus({ preventScroll: true });
	return true;
}

/**
 * Scrolls the chart so that a task's row ends above a sheet `height` px high at the bottom of the
 * viewport (WCAG 2.4.11: a sheet never covers the focused row). The chart needs room to scroll
 * that far: Gantt.svelte adds the sheet's height below its rows (`--gantt-inset`).
 */
export function keepRowClear(
	key: string | null,
	height: number,
	root: ParentNode = document,
	viewport: number = window.innerHeight,
): void {
	const row = key === null || height <= 0 ? null : rowOf(root, key);
	const scroller = row?.closest<HTMLElement>('.scroller');
	if (!row || !scroller) return;
	const limit = viewport - height - 8;
	const over = row.getBoundingClientRect().bottom - limit;
	if (over > 0) scroller.scrollTop += over;
}
