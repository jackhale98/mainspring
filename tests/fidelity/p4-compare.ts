// SPDX-License-Identifier: GPL-2.0-or-later
// The comparison P4 makes for renameTask, renameResource and format (schedule.property.test.ts): the
// engine results must be equal apart from names, source lines and timings, and after a rename that
// sets an id (polish item 15), with the task read under its new id. TaskJuggler orders its work by
// priority, path criticalness and declaration order (Project.rb:1185-1187, Project#scheduleScenario),
// never by id, and the bridge lists bookings in task declaration order (serialize.rb #bookings), so a
// new id changes nothing else. Apart from the test file so that it has unit tests (p4-compare.test.ts).
import type { ScheduleResult } from '../../src/engine/protocol';

/**
 * The result with task `from` read under the id `to`, field by field: a task's id and parent, the
 * `depends` and `precedes` entries that name it, and its bookings. Not a text replacement over the
 * JSON: the default scenario's id is `plan`, so renaming a task `plan` renamed the scenario keys too
 * (nightly 2026-11-18, regressions.json).
 */
export function withTaskId(r: ScheduleResult, from: string, to: string): ScheduleResult {
	const id = (x: string): string => (x === from ? to : x);
	return {
		...r,
		tasks: r.tasks.map((t) => ({
			...t,
			id: id(t.id),
			parent: t.parent === null ? null : id(t.parent),
			scenarios: Object.fromEntries(
				Object.entries(t.scenarios).map(([k, s]) => [
					k,
					{
						...s,
						depends: s.depends.map((d) => ({ ...d, task: id(d.task) })),
						precedes: s.precedes.map((d) => ({ ...d, task: id(d.task) })),
					},
				]),
			),
		})),
		bookings: r.bookings.map((b) => ({ ...b, task: id(b.task) })),
	};
}

/** The result without what a rename or a format may change: names, source lines, timings. */
export function normalized(r: ScheduleResult, names: boolean): string {
	const { revision: _r, timings: _t, ...rest } = r;
	const copy = JSON.parse(JSON.stringify(rest)) as {
		tasks: Array<{ name: string; source: { line: number | null; column: number | null } | null }>;
		resources: Array<{
			name: string;
			source: { line: number | null; column: number | null } | null;
		}>;
		messages: Array<{ line?: number | null; column?: number | null; text?: string }>;
	};
	for (const x of [...copy.tasks, ...copy.resources]) {
		if (x.source) x.source = { ...x.source, line: null, column: null };
		if (names) x.name = '';
	}
	for (const m of copy.messages) {
		delete m.line;
		delete m.column;
		delete m.text;
	}
	return JSON.stringify(copy);
}
