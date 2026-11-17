// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's ARIA mirror (phase-3.md 8.1, 10): the model of the `role="grid"` that screen
 * readers and the keyboard use while the canvas draws the picture. It holds the visible window
 * only, at most `MIRROR_ROWS` x `MIRROR_COLS` cells, and says how many rows and columns the whole
 * model has (`aria-rowcount`, `aria-colcount`) and where each row and column stands in it
 * (`aria-rowindex`, `aria-colindex`), so the window is a view of a bigger grid and not the grid.
 * A grid row has no `aria-level` or `aria-expanded` (those are a tree grid's), so the row header
 * says the hierarchy in words: "Dev 1, in Team", "Team, group, expanded".
 * Row 1 is the column headers and column 1 the row headers (the people), so a data cell is at row
 * `row + 2` and column `col + 2`.
 *
 * Each cell carries its accessible name (heat-cell.ts) and, as data, its booked and available
 * minutes, which are exact (integer minutes): the end-to-end gate reads them (16.1).
 *
 * The keys are the grid pattern's: arrows, Home and End (the row's ends), Ctrl+Home and Ctrl+End
 * (the grid's), PageUp and PageDown (a page of rows), and T (today's column).
 *
 * Pure: no DOM. The component rebuilds the mirror 150 ms after a scroll stops, never in a frame.
 */
import { cellFace, cellInfo, cellName } from './heat-cell';
import type { Cell, CellRange } from './heat-layout';
import type { AxisLabels } from './heat-labels';
import type { HeatUnit } from './heat-prefs';
import type { Band, LoadModel, Thresholds } from './types';

export const MIRROR_ROWS = 30;
export const MIRROR_COLS = 20;

export interface MirrorCell {
	readonly row: number;
	readonly col: number;
	readonly name: string;
	/** What the canvas draws in it. */
	readonly face: string;
	readonly band: Band;
	/** Exact integer minutes. */
	readonly booked: number;
	readonly available: number;
	readonly ariaColIndex: number;
}

export interface MirrorRow {
	readonly row: number;
	readonly id: string;
	readonly name: string;
	/** 1 for a root, deeper for members of a group (a grid row has no `aria-level`, so the row header says it). */
	readonly level: number;
	/** The name of the group the row is a member of, or null for a root. */
	readonly parent: string | null;
	readonly group: boolean;
	readonly expanded: boolean | null;
	readonly ariaRowIndex: number;
	readonly cells: readonly MirrorCell[];
}

export interface MirrorColumn {
	readonly col: number;
	readonly text: string;
	readonly ariaColIndex: number;
}

export interface Mirror {
	/** Data rows plus the header row. */
	readonly ariaRowCount: number;
	/** Data columns plus the row-header column. */
	readonly ariaColCount: number;
	readonly range: CellRange;
	readonly columns: readonly MirrorColumn[];
	readonly rows: readonly MirrorRow[];
}

/**
 * The window the mirror holds: the visible cells, cut to the caps around the cell that has the
 * focus (or the window's start when there is none).
 */
export function mirrorRange(visible: CellRange, focus: Cell | null): CellRange {
	const cut = (lo: number, hi: number, cap: number, at: number | null): [number, number] => {
		if (hi - lo <= cap) return [lo, hi];
		const start = at === null ? lo : Math.max(lo, Math.min(at - Math.floor(cap / 2), hi - cap));
		return [start, start + cap];
	};
	const [r0, r1] = cut(visible.r0, visible.r1, MIRROR_ROWS, focus?.row ?? null);
	const [c0, c1] = cut(visible.c0, visible.c1, MIRROR_COLS, focus?.col ?? null);
	return { r0, r1, c0, c1 };
}

export interface MirrorInput {
	readonly model: LoadModel;
	readonly labels: AxisLabels;
	readonly thresholds: Thresholds;
	readonly unit: HeatUnit;
	readonly range: CellRange;
}

/** The nearest row above that is one level up: the group a row belongs to. */
function parentOf(model: LoadModel, r: number): string | null {
	const depth = model.rows[r]?.depth ?? 0;
	for (let i = r - 1; depth > 0 && i >= 0; i--) {
		const row = model.rows[i];
		if (row && row.depth === depth - 1) return row.name;
	}
	return null;
}

export function buildMirror(i: MirrorInput): Mirror {
	const { model, labels, range } = i;
	const columns: MirrorColumn[] = [];
	for (let c = range.c0; c < range.c1; c++) {
		columns.push({ col: c, text: labels.period[c] ?? '', ariaColIndex: c + 2 });
	}
	const rows: MirrorRow[] = [];
	for (let r = range.r0; r < range.r1; r++) {
		const row = model.rows[r];
		if (!row) continue;
		const cells: MirrorCell[] = [];
		for (let c = range.c0; c < range.c1; c++) {
			const info = cellInfo(model, labels, r, c, i.thresholds);
			cells.push({
				row: r,
				col: c,
				name: cellName(info, i.unit, i.thresholds),
				face: cellFace(info, i.unit),
				band: info.band,
				booked: info.booked,
				available: info.available,
				ariaColIndex: c + 2,
			});
		}
		rows.push({
			row: r,
			id: row.id,
			name: row.name,
			level: row.depth + 1,
			parent: parentOf(model, r),
			group: row.group,
			expanded: row.expanded,
			ariaRowIndex: r + 2,
			cells,
		});
	}
	return {
		ariaRowCount: model.rows.length + 1,
		ariaColCount: model.axis.count + 1,
		range,
		columns,
		rows,
	};
}

export interface NavDims {
	readonly rows: number;
	readonly cols: number;
	/** Rows a PageUp or PageDown moves: a screenful. */
	readonly page: number;
	/** The column that holds today, for T; null when today is outside the frame. */
	readonly today: number | null;
}

export interface NavKey {
	readonly key: string;
	readonly ctrl?: boolean;
	readonly meta?: boolean;
	readonly alt?: boolean;
	readonly shift?: boolean;
}

/**
 * The cell a key moves the focus to, or null when the key is not a navigation key (or does not
 * move). Alt and Shift belong to other things (a task's move keys, Shift+Tab), and are left alone.
 */
export function moveFocus(at: Cell, k: NavKey, d: NavDims): Cell | null {
	if (d.rows === 0 || d.cols === 0 || k.alt || k.shift) return null;
	const clampRow = (r: number): number => Math.max(0, Math.min(d.rows - 1, r));
	const clampCol = (c: number): number => Math.max(0, Math.min(d.cols - 1, c));
	const whole = k.ctrl === true || k.meta === true;
	let next: Cell;
	switch (k.key) {
		case 'ArrowUp':
			next = { row: clampRow(at.row - 1), col: at.col };
			break;
		case 'ArrowDown':
			next = { row: clampRow(at.row + 1), col: at.col };
			break;
		case 'ArrowLeft':
			next = { row: at.row, col: clampCol(at.col - 1) };
			break;
		case 'ArrowRight':
			next = { row: at.row, col: clampCol(at.col + 1) };
			break;
		case 'Home':
			next = { row: whole ? 0 : at.row, col: 0 };
			break;
		case 'End':
			next = { row: whole ? d.rows - 1 : at.row, col: d.cols - 1 };
			break;
		case 'PageUp':
			next = { row: clampRow(at.row - Math.max(1, d.page)), col: at.col };
			break;
		case 'PageDown':
			next = { row: clampRow(at.row + Math.max(1, d.page)), col: at.col };
			break;
		case 't':
		case 'T':
			if (whole || d.today === null) return null;
			next = { row: at.row, col: d.today };
			break;
		default:
			return null;
	}
	return next.row === at.row && next.col === at.col ? null : next;
}
