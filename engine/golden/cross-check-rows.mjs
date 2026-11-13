// SPDX-License-Identifier: GPL-2.0-or-later
//
// cross-check-rows.mjs - pure helpers for the serializer cross-check of
// record-native.mjs (docs/phases/phase-0.md 6.2 step 5): the parser for the
// CSV that tj3 writes from cross-check.tji, and the rows that report should
// hold for a golden's result (dates, and since schema 2 the precursors and
// completion columns). No file system and no child processes, so
// tests/golden/record-lib.test.ts tests them directly. Split from lib.mjs to
// keep both files under 400 lines.

import { minutesToIso } from './lib.mjs';

/**
 * Parse TaskJuggler's CSV (CSVFile.rb): ';' separators, '"' quotes, '""' for a
 * quote inside a quoted field, '\n' line ends.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
	/** @type {string[][]} */
	const rows = [];
	/** @type {string[]} */
	let row = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ';') {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/**
 * @typedef {{ id: string, name: string, active: boolean }} Scenario
 * @typedef {{ start: number | null, end: number | null }} TaskDates
 * @typedef {{ id: string, scenarios: Record<string, TaskDates> }} Task
 * @typedef {{ project: { start: string, scenarios: Scenario[] } | null, tasks: Task[] }} Result
 */

/**
 * The rows the cross-check report should contain for a serializer result:
 * one per task (pre-order) and active scenario (pre-order), as
 * "scenario name | task id | start | end".
 * @param {Result} result
 * @returns {string[]}
 */
export function expectedRows(result) {
	if (!result.project) return [];
	const { start } = result.project;
	const active = result.project.scenarios.filter((s) => s.active);
	/** @type {string[]} */
	const rows = [];
	for (const t of result.tasks) {
		for (const s of active) {
			const d = t.scenarios[s.id];
			rows.push([s.name, t.id, minutesToIso(start, d?.start ?? null), minutesToIso(start, d?.end ?? null)].join(' | '));
		}
	}
	return rows;
}

const CSV_DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/** The header cross-check.tji's columns produce, in order. */
export const CROSS_CHECK_HEADER = ['Scenario', 'Id', 'Start', 'End', 'Precursors', 'Completion'];

/** The precursors column line of cross-check.tji, with its line break. */
const PRECURSORS_LINE = /^[ \t]*precursors \{[^\n]*\},\n/m;

/**
 * cross-check.tji without its precursors column, for a run whose result is not ok. tj3's
 * precursors query reads lists that only TaskScenario#prepareScheduling creates
 * (engine/tj/lib/taskjuggler/TaskScenario.rb:75-79), so a scenario that scheduling never
 * prepared (an error stopped an earlier one) ends report generation with a NoMethodError at
 * TaskScenario.rb:1470, and tj3 writes no CSV. Such runs do not compare precursors anyway
 * (linkRowDiffs). Throws if the template has no precursors line.
 * @param {string} template
 */
export function withoutPrecursors(template) {
	if (!PRECURSORS_LINE.test(template)) throw new Error('cross-check.tji lost its precursors column line');
	return template.replace(PRECURSORS_LINE, '');
}

/**
 * The data rows of the cross-check CSV as [scenario, id, start, end, precursors, completion],
 * with the id carried forward: TaskJuggler leaves it empty on the rows of the second and later
 * scenarios of a task. A report made without the precursors column (withoutPrecursors) gives
 * empty precursors.
 * @param {string[][]} csv  parsed CSV including the header row
 * @returns {string[][]}
 */
function crossCheckCells(csv) {
	const [header, ...rows] = csv;
	const text = header?.join(';');
	const full = CROSS_CHECK_HEADER.join(';');
	const short = CROSS_CHECK_HEADER.filter((h) => h !== 'Precursors').join(';');
	if (text !== full && text !== short) {
		throw new Error(`unexpected cross-check CSV header: ${JSON.stringify(header)}`);
	}
	const hasPrecursors = text === full;
	let lastId = '';
	return rows.map((cells) => {
		const [scenario = '', id = '', start = '', end = ''] = cells;
		const precursors = hasPrecursors ? (cells[4] ?? '') : '';
		const completion = (hasPrecursors ? cells[5] : cells[4]) ?? '';
		lastId = id || lastId;
		return [scenario, lastId, start, end, precursors, completion];
	});
}

/**
 * Rows of the cross-check CSV in the same form as expectedRows. Non-date
 * cells (empty, "Error") become null.
 * @param {string[][]} csv  parsed CSV including the header row
 * @returns {string[]}
 */
export function csvRows(csv) {
	const date = (/** @type {string} */ v) => (CSV_DATE.test(v) ? v : null);
	return crossCheckCells(csv).map(([scenario, id, start = '', end = '']) =>
		[scenario, id, date(start), date(end)].join(' | '));
}

/**
 * @typedef {{ task: string, onEnd: boolean }} Dep
 * @typedef {{ depends?: Dep[], precedes?: Dep[], complete?: number | null }} LinkData
 * @typedef {{ id: string, scenarios: Record<string, LinkData> }} LinkTask
 * @typedef {{ project: { scenarios: Scenario[] } | null, tasks: LinkTask[] }} LinkResult
 */

/**
 * The dependency and completion rows the cross-check report should contain for a serializer
 * result, one per task (pre-order) and active scenario (pre-order), as
 * "scenario name | task id | precursors | completion".
 *
 * Precursors are what tj3's `precursors` column lists for the task (TaskScenario#query_precursors,
 * engine/tj/lib/taskjuggler/TaskScenario.rb:1466-1493, from the lists TaskScenario#Xref fills at
 * TaskScenario.rb:166-179): each of its own `depends` entries as "<other> ]->[" (after the other
 * task's end) or "<other> [->[" (after its start), and each other task's `precedes` entry that
 * names it as "<other> ]->[" (before this task's start) or "<other> ]->]" (before its end). They
 * are sorted, because Xref's order mixes the two lists. Gaps have no report column.
 *
 * Completion is "<n>%" with n the integer part, as TaskScenario#query_complete prints a `complete`
 * the plan sets (TaskScenario.rb:1311-1320), or "*" when unset: tj3 then prints a completion it
 * computes from the dates, which the serializer never reports.
 * @param {LinkResult} result
 * @returns {string[]}
 */
export function expectedLinkRows(result) {
	if (!result.project) return [];
	const active = result.project.scenarios.filter((s) => s.active);
	/** @type {Map<string, string[]>} */
	const items = new Map();
	const add = (/** @type {string} */ scenario, /** @type {string} */ task, /** @type {string} */ item) => {
		const key = `${scenario}\n${task}`;
		const list = items.get(key);
		if (list) list.push(item);
		else items.set(key, [item]);
	};
	for (const t of result.tasks) {
		for (const s of active) {
			const d = t.scenarios[s.id];
			for (const dep of d?.depends ?? []) add(s.id, t.id, `${dep.task} ${dep.onEnd ? ']->[' : '[->['}`);
			for (const dep of d?.precedes ?? []) add(s.id, dep.task, `${t.id} ${dep.onEnd ? ']->]' : ']->['}`);
		}
	}
	/** @type {string[]} */
	const rows = [];
	for (const t of result.tasks) {
		for (const s of active) {
			const complete = t.scenarios[s.id]?.complete ?? null;
			const precursors = [...(items.get(`${s.id}\n${t.id}`) ?? [])].sort().join(', ');
			rows.push([s.name, t.id, precursors, complete === null ? '*' : `${Math.trunc(complete)}%`].join(' | '));
		}
	}
	return rows;
}

/**
 * Rows of the cross-check CSV in the same form as expectedLinkRows, with the precursor items
 * sorted. Each item is "<task id> <dependency>" (the report's `listitem`), and items are
 * separated by ", ", which no task id contains.
 * @param {string[][]} csv  parsed CSV including the header row
 * @returns {string[]}
 */
export function csvLinkRows(csv) {
	return crossCheckCells(csv).map(([scenario, id, , , precursors = '', completion = '']) => {
		const list = precursors === '' ? [] : precursors.split(', ').map((s) => s.trim());
		return [scenario, id, list.sort().join(', '), completion].join(' | ');
	});
}

/**
 * Lines describing where expectedLinkRows and csvLinkRows differ (at most `limit`). A "*"
 * completion in an expected row matches any reported value.
 *
 * With `precursors` false the precursor lists are not compared. The caller passes the
 * serializer's `ok`: precursors are the lists TaskScenario#Xref fills (TaskScenario.rb:166-179),
 * and a run that stops with an error may have stopped inside Xref, before it reached the later
 * tasks (or another scenario), while the golden lists every entry TaskJuggler would accept.
 * @param {string[]} expected
 * @param {string[]} actual
 * @param {number} [limit]
 * @param {boolean} [precursors]
 */
export function linkRowDiffs(expected, actual, limit = 10, precursors = true) {
	const same = (/** @type {string | undefined} */ e, /** @type {string | undefined} */ a) => {
		if (e === undefined || a === undefined) return e === a;
		const ef = e.split(' | ');
		const af = a.split(' | ');
		const keep = precursors ? 3 : 2;
		return ef.length === 4 && af.length === 4 &&
			ef.slice(0, keep).join(' | ') === af.slice(0, keep).join(' | ') && (ef[3] === '*' || ef[3] === af[3]);
	};
	const out = [];
	for (let i = 0; i < Math.max(expected.length, actual.length) && out.length < limit; i++) {
		if (!same(expected[i], actual[i])) {
			out.push(`row ${i + 1}: serializer ${expected[i] ?? '(none)'}; report ${actual[i] ?? '(none)'}`);
		}
	}
	return out;
}

/**
 * Lines describing where two row lists differ (at most `limit`).
 * @param {string[]} expected
 * @param {string[]} actual
 * @param {number} [limit]
 */
export function rowDiffs(expected, actual, limit = 10) {
	const out = [];
	for (let i = 0; i < Math.max(expected.length, actual.length) && out.length < limit; i++) {
		if (expected[i] !== actual[i]) {
			out.push(`row ${i + 1}: serializer ${expected[i] ?? '(none)'}; report ${actual[i] ?? '(none)'}`);
		}
	}
	return out;
}
