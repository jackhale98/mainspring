// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The text of the Gantt's task list, row by row (phase-2.md 10.1): what each treegrid cell says,
 * as plain data. The component only draws it, and a test asserts that the cells in the page equal
 * these texts, so the accessible mirror cannot drift from the model.
 *
 * Everything is read, nothing is computed: dates are the engine's minutes written with `Intl` in
 * the project's zone, effort and length are the text's own words (`effort 5d`), people are the
 * engine's allocations, and float and critical are the display estimates of ADR-0007 (so the
 * header says "(estimate)"). A task the engine has not scheduled shows no dates.
 */
import { printDuration } from '../tjp/values';
import type { TaskSymbol } from '../tjp/index';
import { strings } from '../strings';
import { floatAmount } from './describe';
import type { ColumnId } from './columns';
import type { GanttAnalysis, GanttModel, GanttRow } from './model';
import { formatMinutes } from './ticks';

const G = strings.grid;

/** One cell: its words and whether it has anything to say. */
export interface GridCell {
	readonly column: ColumnId;
	readonly text: string;
	/** True for a dash: the cell shows `empty` and a screen reader hears `emptyWords`. */
	readonly blank: boolean;
}

export interface GridRowInput {
	readonly model: GanttModel;
	/** The driving-path estimates of the shown result, or null before they are computed. */
	readonly analysis: Pick<GanttAnalysis, 'critical' | 'floatMin'> | null;
	/** The task's own `effort`, `length` or `duration`, by task id; see `sizingOf`. */
	readonly sizing: (id: string) => string | null;
	/** Outline keys of rows with an edit waiting for its result. */
	readonly pending?: ReadonlySet<string>;
}

const SIZING_ATTRS: ReadonlySet<string> = new Set(['effort', 'length', 'duration']);

/**
 * What a task says about its size, "5d effort", from its own attributes (not inherited ones). The
 * scenario-free statement wins over a scenario's. Null when the task has none.
 */
export function sizingOf(sym: TaskSymbol | undefined): string | null {
	if (!sym) return null;
	let found: { keyword: string; value: string } | null = null;
	for (const a of sym.attrs) {
		if (!SIZING_ATTRS.has(a.keyword) || a.textOnly) continue;
		const v = a.parsed;
		if (v?.kind !== 'duration') continue;
		const text = printDuration(v.value);
		if (!text.ok) continue;
		if (a.scenario === null) return G.sizing(text.value, a.keyword);
		found ??= { keyword: a.keyword, value: text.value };
	}
	return found ? G.sizing(found.value, found.keyword) : null;
}

function cell(column: ColumnId, text: string | null): GridCell {
	return text === null || text === ''
		? { column, text: G.empty, blank: true }
		: { column, text, blank: false };
}

/** The status words: text only wins, since that is what the person can act on. */
function statusOf(row: GanttRow, pending: boolean): string {
	if (row.textOnly) return G.status.textOnly;
	if (pending) return G.status.pending;
	return row.scheduled ? G.status.scheduled : G.status.notScheduled;
}

/** The cells of one row, in column order. */
export function gridCells(row: GanttRow, i: GridRowInput): readonly GridCell[] {
	const cal = i.model.calendar;
	const dated = row.scheduled && row.start !== null && row.end !== null && cal !== null;
	// The end is the instant the work stops: the last day worked is the minute before it.
	const start = dated ? formatMinutes(cal, row.start as number, 'medium') : null;
	const end = dated
		? formatMinutes(cal, Math.max(row.start as number, (row.end as number) - 1), 'medium')
		: null;
	const a = i.analysis;
	const id = row.id;
	let float: string | null = null;
	let critical: string | null = null;
	if (a && id !== null && row.scheduled) {
		critical = a.critical.has(id) ? G.yes : G.no;
		const f = a.floatMin.get(id);
		float = f === undefined ? null : f <= 0 ? '0' : floatAmount(f, i.model);
	}
	return [
		{ column: 'name', text: row.name, blank: false },
		cell('start', start),
		cell('end', end),
		cell('effort', id === null ? null : i.sizing(id)),
		cell('people', row.people.length > 0 ? row.people.join(', ') : null),
		cell('float', float),
		cell('critical', critical),
		cell('status', statusOf(row, i.pending?.has(row.key) ?? false)),
	];
}

/** What a screen reader hears for a cell: its words, or "none" for a blank one. */
export function spokenText(c: GridCell): string {
	return c.blank ? G.emptyWords : c.text;
}
