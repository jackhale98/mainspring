// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The geometry of the Gantt picture (phase-4.md 18.20, T18), as plain numbers, so that it is tested
 * without a canvas. The picture is what the chart shows at the moment of the export: the time
 * header across the top, the task-name column down the left and the plot (the Gantt's own grid,
 * bars and lines, painted by `gantt/paint/*`) in the rest, at the device pixel ratio. The task list
 * on screen is DOM, not canvas, so its names are laid out here: each row's name at its depth,
 * after a slot for the open or closed arrow of a container, cut with an ellipsis where it would
 * run out of the column.
 */

/** A picture is never sharper than this, whatever the screen: 3x is the densest phone. */
export const MAX_EXPORT_DPR = 3;

/** The pixel ratio of the picture: the screen's, from 1 to 3. */
export function exportDpr(raw: number): number {
	return Number.isFinite(raw) ? Math.min(MAX_EXPORT_DPR, Math.max(1, raw)) : 1;
}

/** Browsers refuse a canvas much beyond this many pixels (iOS Safari's is about 16.7 million). */
export const MAX_EXPORT_PIXELS = 16_000_000;

/** `dpr`, lowered where the picture would pass `MAX_EXPORT_PIXELS` (a very wide window). */
export function limitDpr(width: number, height: number, dpr: number): number {
	const area = width * height * dpr * dpr;
	return area <= MAX_EXPORT_PIXELS
		? dpr
		: Math.max(1, Math.sqrt(MAX_EXPORT_PIXELS / (width * height)));
}

export interface FrameSpec {
	/** The task-name column's width, in CSS px. */
	readonly names: number;
	/** The time header's height. */
	readonly headerH: number;
	/** The visible plot's size. */
	readonly viewW: number;
	readonly viewH: number;
	readonly dpr: number;
}

export interface FrameSize {
	/** The picture's size in CSS px. */
	readonly width: number;
	readonly height: number;
	/** The PNG's size in pixels. */
	readonly pxWidth: number;
	readonly pxHeight: number;
}

/** The picture's size: the name column beside the plot, the header over them. */
export function frameSize(s: FrameSpec): FrameSize {
	const width = s.names + s.viewW;
	const height = s.headerH + s.viewH;
	return {
		width,
		height,
		pxWidth: Math.max(1, Math.round(width * s.dpr)),
		pxHeight: Math.max(1, Math.round(height * s.dpr)),
	};
}

/** What a row says in the name column. */
export interface NameRow {
	readonly name: string;
	readonly depth: number;
	readonly kind: 'task' | 'container' | 'milestone';
	/** Null for a leaf. */
	readonly expanded: boolean | null;
	/** Shown only as context for a filter: drawn muted. */
	readonly context: boolean;
}

export interface NameLayout {
	/** The column's width. */
	readonly width: number;
	readonly rowHeight: number;
	/** How far the chart is scrolled: the first row in view starts this far up. */
	readonly scrollTop: number;
	readonly viewH: number;
	readonly headerH: number;
	/** Space at the column's left and right edges. */
	readonly pad: number;
	/** How far each level moves a name right. */
	readonly indent: number;
	/** The slot of the arrow before every name, so that names of one depth line up. */
	readonly arrow: number;
}

export interface NameCell {
	readonly row: number;
	/** Where the name starts, and the middle of its row, in the picture's CSS px. */
	readonly x: number;
	readonly y: number;
	/** The name, cut to fit with an ellipsis; empty when nothing of it fits. */
	readonly text: string;
	readonly bold: boolean;
	readonly muted: boolean;
	/** The arrow of a container: pointing down when open, right when closed. */
	readonly arrow: 'open' | 'closed' | null;
	/** The arrow's left edge. */
	readonly arrowX: number;
}

const ELLIPSIS = '…';

/** `text`, or its longest start that fits `max` with an ellipsis after it (empty when none does). */
export function fitText(text: string, max: number, widthOf: (text: string) => number): string {
	if (max <= 0) return '';
	if (widthOf(text) <= max) return text;
	const chars = [...text];
	let lo = 0;
	let hi = chars.length;
	// The most characters whose start plus the ellipsis fits.
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (widthOf(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS) <= max) lo = mid;
		else hi = mid - 1;
	}
	return lo === 0 ? '' : chars.slice(0, lo).join('').trimEnd() + ELLIPSIS;
}

/** The rows in view and where each one's name goes. `widthOf` measures a name in its font. */
export function nameCells(
	rows: readonly NameRow[],
	l: NameLayout,
	widthOf: (text: string, bold: boolean) => number,
): NameCell[] {
	const first = Math.max(0, Math.floor(l.scrollTop / l.rowHeight));
	const last = Math.min(rows.length, Math.ceil((l.scrollTop + l.viewH) / l.rowHeight));
	const out: NameCell[] = [];
	for (let i = first; i < last; i++) {
		const row = rows[i];
		if (!row) continue;
		const bold = row.kind === 'container';
		const arrowX = l.pad + row.depth * l.indent;
		const x = arrowX + l.arrow;
		out.push({
			row: i,
			x,
			y: l.headerH + i * l.rowHeight - l.scrollTop + l.rowHeight / 2,
			text: fitText(row.name, l.width - l.pad - x, (t) => widthOf(t, bold)),
			bold,
			muted: row.context,
			arrow: row.expanded === null ? null : row.expanded ? 'open' : 'closed',
			arrowX,
		});
	}
	return out;
}
