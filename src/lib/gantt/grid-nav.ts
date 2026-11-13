// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The keyboard model of the Gantt's treegrid (phase-2.md 10.2, after the WAI-ARIA Authoring
 * Practices treegrid), as a pure function from a key press to what should happen. The component
 * does the happening: moving the DOM focus, toggling a row, selecting a task.
 *
 * Focus is on a row (`col: null`) or on one of its cells (`col` is an index into the columns
 * that are drawn). One element of the grid is in the tab order at a time (roving tabindex).
 *
 * - Up and Down move between rows and keep the column. Page Up and Page Down go a page.
 * - Right on a collapsed row expands it; on an expanded row or a leaf it goes to the first cell;
 *   on a cell it goes one cell right.
 * - Left on an expanded row collapses it; on a collapsed row or a leaf it goes to the parent row;
 *   on the first cell it goes back to the row, on another cell one cell left.
 * - Home and End go to the first and last row (on a row) or cell (on a cell); with Ctrl or Cmd
 *   they go to the first and last row in either case.
 * - Enter opens the task (select, and later the inspector); Space selects it; F2 renames.
 *
 * Moving focus never selects: the selection drives the editor cursor (T15), and a keyboard user
 * arrowing past forty rows should not drag the editor along.
 */

export interface GridFocus {
	/** Index into the visible rows. */
	readonly row: number;
	/** Index into the shown columns, or null for the row itself. */
	readonly col: number | null;
}

export interface GridShape {
	readonly rows: number;
	/** How many columns are drawn (at least 1). */
	readonly cols: number;
	/** Whole rows in a page, for Page Up and Page Down. */
	readonly page: number;
	/** `true` open, `false` closed, `null` a leaf. */
	expanded(row: number): boolean | null;
	/** The visible row of the parent, or -1 for a top-level task. */
	parent(row: number): number;
}

export type GridKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export type GridMove =
	| { readonly kind: 'ignore' }
	| { readonly kind: 'focus'; readonly to: GridFocus }
	| { readonly kind: 'toggle'; readonly row: number; readonly open: boolean }
	| { readonly kind: 'open'; readonly row: number }
	| { readonly kind: 'select'; readonly row: number }
	| { readonly kind: 'rename'; readonly row: number };

const IGNORE: GridMove = { kind: 'ignore' };
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function gridMove(at: GridFocus, key: GridKey, shape: GridShape): GridMove {
	if (shape.rows === 0) return IGNORE;
	const last = shape.rows - 1;
	const row = clamp(at.row, 0, last);
	const jump = key.ctrlKey || key.metaKey;
	const go = (r: number, col: number | null = at.col): GridMove => ({
		kind: 'focus',
		to: { row: clamp(r, 0, last), col },
	});
	// Alt and Shift combinations belong to the shortcuts of the interactions (T16).
	if (key.altKey || key.shiftKey) return IGNORE;
	if (jump && key.key !== 'Home' && key.key !== 'End') return IGNORE;

	switch (key.key) {
		case 'ArrowDown':
			return go(row + 1);
		case 'ArrowUp':
			return go(row - 1);
		case 'PageDown':
			return go(row + Math.max(1, shape.page));
		case 'PageUp':
			return go(row - Math.max(1, shape.page));
		case 'Home':
			return jump || at.col === null ? go(0, jump ? at.col : null) : go(row, 0);
		case 'End':
			return jump || at.col === null ? go(last, jump ? at.col : null) : go(row, shape.cols - 1);
		case 'ArrowRight': {
			if (at.col !== null) return go(row, Math.min(shape.cols - 1, at.col + 1));
			return shape.expanded(row) === false ? { kind: 'toggle', row, open: true } : go(row, 0);
		}
		case 'ArrowLeft': {
			if (at.col !== null) return go(row, at.col === 0 ? null : at.col - 1);
			if (shape.expanded(row) === true) return { kind: 'toggle', row, open: false };
			const p = shape.parent(row);
			return p >= 0 ? go(p, null) : IGNORE;
		}
		case 'Enter':
			return { kind: 'open', row };
		case ' ':
			return { kind: 'select', row };
		case 'F2':
			return { kind: 'rename', row };
		default:
			return IGNORE;
	}
}
