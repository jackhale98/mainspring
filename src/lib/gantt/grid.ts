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
import type { ProjectInfo } from '../../engine/protocol';
import { printDuration } from '../tjp/values';
import type { TaskSymbol } from '../tjp/index';
import { strings } from '../strings';
import { floatAmount } from './describe';
import type { ColumnId } from './columns';
import type { GanttAnalysis, GanttModel, GanttRow } from './model';
import type { RowLinkRef } from './row-links';
import { formatMinutes } from './ticks';

const G = strings.grid;

/** One cell: its words and whether it has anything to say. */
export interface GridCell {
	readonly column: ColumnId;
	readonly text: string;
	/** True for a dash: the cell shows `empty` and a screen reader hears `emptyWords`. */
	readonly blank: boolean;
	/** What a screen reader hears instead of the text, when the text alone says too little. */
	readonly label?: string;
	/** The hover text. */
	readonly hint?: string;
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
 * The shown scenario and its parents, nearest first: ['delayed', 'plan']. What a task says in a
 * scenario is what is written for it, else what its parent scenario says.
 */
export function scenarioChain(
	project: Pick<ProjectInfo, 'scenarios'> | null,
	shown: string | null,
): readonly string[] {
	const chain: string[] = [];
	let id: string | null = shown;
	while (id !== null && !chain.includes(id)) {
		chain.push(id);
		const at: string = id;
		id = project?.scenarios.find((s) => s.id === at)?.parent ?? null;
	}
	return chain;
}

/**
 * The statement that sets a task's size (`effort`, `length` or `duration`) in the shown scenario:
 * the last one written wins, whichever it is (setDurationAttribute). A statement for a scenario
 * counts if it names the shown scenario or one of its parents; one with no scenario is the top
 * scenario's, which the others inherit. A statement for the shown scenario beats one for its
 * parent whatever their order, and a statement for another scenario (`delayed:effort` while `plan`
 * is shown) does not count. Null when there is none. The task inspector reads the same site.
 */
export function sizingSite(
	sym: TaskSymbol | undefined,
	chain: readonly string[] = [],
): TaskSymbol['attrs'][number] | null {
	if (!sym) return null;
	const top = Math.max(0, chain.length - 1);
	let best: { rank: number; attr: TaskSymbol['attrs'][number] } | null = null;
	for (const a of sym.attrs) {
		if (!SIZING_ATTRS.has(a.keyword)) continue;
		const rank = a.scenario === null ? top : chain.indexOf(a.scenario);
		if (rank < 0) continue;
		if (best === null || rank <= best.rank) best = { rank, attr: a };
	}
	return best?.attr ?? null;
}

/**
 * What a task says about its size, "5d effort", from its own attributes (not inherited from a
 * parent task) in the shown scenario (`sizingSite`). A winner the editor cannot read (a macro, a
 * variable) says so, rather than showing nothing. Null when there is none.
 */
export function sizingOf(
	sym: TaskSymbol | undefined,
	chain: readonly string[] = [],
): string | null {
	const a = sizingSite(sym, chain);
	if (a === null) return null;
	if (a.textOnly) return G.sizingMacro;
	const v = a.parsed;
	const text = v?.kind === 'duration' ? printDuration(v.value) : null;
	return text?.ok ? G.sizing(text.value, a.keyword) : G.sizingText;
}

/** One end of a link as the eye reads it: its row number, the kind if unusual, the gap: "3SS +2d". */
export function linkText(r: RowLinkRef): string {
	return `${r.number}${G.links.typeShort[r.type]}${r.gaps.map((g) => ` ${g.text}`).join('')}`;
}

/** "+2d" as "2 days", "+4h" as "4 hours", "+90min" as "90 minutes": units are said, not spelt. */
function amountWords(text: string): string {
	const m = /^\+?(\d+)(d|h|min)$/.exec(text);
	return m ? G.links.units[m[2] as 'd' | 'h' | 'min'](Number(m[1])) : text;
}

/** The same end in words, after a name or an id: "Research (start to start, plus 2d)". */
export function linkWords(r: RowLinkRef, label: string): string {
	const parts: string[] = [];
	if (r.type !== 'finish-start') parts.push(G.links.typeWords[r.type]);
	for (const g of r.gaps)
		parts.push(G.links.gapWords(amountWords(g.text), g.kind === 'gapduration'));
	if (r.state === 'pending') parts.push(G.links.pending);
	return parts.length > 0 ? `${label} (${parts.join(G.links.and)})` : label;
}

/**
 * The Predecessors or Successors cell: row numbers for the eye, task names for a screen reader
 * ("Predecessors: Research, Sketch") and ids on hover. Nothing here is derived: `refs` is the
 * model's list (row-links.ts).
 */
function linksCell(column: 'predecessors' | 'successors', refs: readonly RowLinkRef[]): GridCell {
	if (refs.length === 0) return cell(column, null);
	const ids = column === 'predecessors' ? G.links.predecessorsIds : G.links.successorsIds;
	const names = column === 'predecessors' ? G.links.predecessors : G.links.successors;
	return {
		column,
		text: refs.map(linkText).join(', '),
		blank: false,
		label: names(refs.map((r) => linkWords(r, r.name)).join(', ')),
		hint: ids(refs.map((r) => linkWords(r, r.id)).join(', ')),
	};
}

function cell(column: ColumnId, text: string | null): GridCell {
	return text === null || text === ''
		? { column, text: G.empty, blank: true }
		: { column, text, blank: false };
}

/**
 * The status words: text only wins, since that is what the person can act on; then pending; a row
 * with dates from the last good schedule, while the newest run failed, is out of date.
 */
function statusOf(row: GanttRow, pending: boolean, outOfDate: boolean): string {
	if (row.textOnly) return G.status.textOnly;
	if (pending) return G.status.pending;
	if (!row.scheduled) return G.status.notScheduled;
	return outOfDate ? G.status.outOfDate : G.status.scheduled;
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
	const info = i.model.rowInfo.get(row.key);
	return [
		cell('number', info ? String(info.number) : null),
		{ column: 'name', text: row.name, blank: false },
		cell('start', start),
		cell('end', end),
		cell('effort', id === null ? null : i.sizing(id)),
		cell('people', row.people.length > 0 ? row.people.join(', ') : null),
		cell('float', float),
		cell('critical', critical),
		cell('status', statusOf(row, i.pending?.has(row.key) ?? false, i.model.dimmed)),
		linksCell('predecessors', info?.predecessors ?? []),
		linksCell('successors', info?.successors ?? []),
	];
}

/** What a screen reader hears for a cell: its label if it has one, its words, or "none" for a blank one. */
export function spokenText(c: GridCell): string {
	return c.label ?? (c.blank ? G.emptyWords : c.text);
}
