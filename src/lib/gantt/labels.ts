// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where a task's name is drawn (phase-2.md 8.1), as one rule that the painter and the layout
 * share: inside the bar when it fits with its padding, else beside it, after the bar's float tail
 * and a gap. The layout keeps the run of every row (`GanttLayout.labels`) so that hit testing,
 * link routing and the today and status-date lines can leave the text alone, and the painter
 * draws from the same function, so what was reserved is what is drawn.
 *
 * Widths come from a `TextMeasure`; the painter measures with the canvas it draws on, the layout
 * with a scratch canvas (paint/canvas.ts `measureFor`). Without one (tests, a server) no run is
 * reserved.
 */
import type { GanttRow } from './model';
import type { Theme } from './paint/theme';
import type { TimeScale } from './scale';

/** The fonts a label can be set in: in a bar, beside a task, or a milestone's display serif. */
export type LabelFont = 'bar' | 'side' | 'display';

export interface TextMeasure {
	width(font: LabelFont, text: string): number;
}

/** Numbers per row in `GanttLayout.labels`: x0, x1, and 1 for a name inside its bar, else 0. */
export const LABEL_STRIDE = 3;

/** A run that a caller owns and `labelRunInto` fills in place: a frame allocates nothing. */
export interface LabelRun {
	x0: number;
	x1: number;
	/** The name is inside its bar: the bar already covers it. */
	inside: boolean;
}

/** The x where the bar and its float tail end: a label beside the bar starts a gap after it. */
export function tailEndX(
	row: Pick<GanttRow, 'lateEnd' | 'floatMin'>,
	scale: Pick<TimeScale, 'x'>,
	barX: number,
	barW: number,
): number {
	const end = barX + barW;
	return row.lateEnd !== null && row.floatMin !== null && row.floatMin > 0
		? Math.max(scale.x(row.lateEnd), end)
		: end;
}

/** The font a name beside its bar is set in. */
export const sideFont = (row: Pick<GanttRow, 'kind'>): LabelFont =>
	row.kind === 'milestone' ? 'display' : 'side';

/**
 * Fills `out` with the run of a row's name: inside the bar for a task that is not text only and
 * whose name fits with a pad on each side, else beside it. A summary has no name beside it (its
 * name is in the task list): false, and `out` is left alone.
 */
export function labelRunInto(
	out: LabelRun,
	row: Pick<GanttRow, 'kind' | 'textOnly' | 'name' | 'lateEnd' | 'floatMin'>,
	scale: Pick<TimeScale, 'x'>,
	barX: number,
	barW: number,
	theme: Pick<Theme, 'labelPad' | 'labelGap'>,
	measure: TextMeasure,
): boolean {
	const inner = measure.width('bar', row.name);
	if (row.kind === 'task' && !row.textOnly && inner + 2 * theme.labelPad <= barW) {
		out.x0 = barX + theme.labelPad;
		out.x1 = out.x0 + inner;
		out.inside = true;
		return true;
	}
	if (row.kind === 'container') return false;
	out.x0 = tailEndX(row, scale, barX, barW) + theme.labelGap;
	out.x1 = out.x0 + measure.width(sideFont(row), row.name);
	out.inside = false;
	return true;
}

/**
 * Where what stands beside each row's bar begins: its name when it is not inside the bar, then
 * the avatars, which start at the same place when the name is inside. Infinity for a row with
 * neither (or no bar). The links keep their runs along a bar's mid-height short of it (route.ts).
 * Avatars are known from the row alone, names only with the text measured (`labels`).
 */
export function besideStarts(
	rows: readonly Pick<GanttRow, 'people' | 'lateEnd' | 'floatMin'>[],
	bars: { readonly x: Float64Array; readonly w: Float64Array },
	labels: Float64Array,
	scale: Pick<TimeScale, 'x'>,
	gap: number,
): Float64Array {
	const out = new Float64Array(rows.length).fill(Infinity);
	rows.forEach((r, i) => {
		const x = bars.x[i];
		if (x === undefined || Number.isNaN(x)) return;
		const named = (labels[LABEL_STRIDE * i] ?? NaN) >= 0 && labels[LABEL_STRIDE * i + 2] === 0;
		if (named || r.people.length > 0) out[i] = tailEndX(r, scale, x, bars.w[i] ?? 0) + gap;
	});
	return out;
}
