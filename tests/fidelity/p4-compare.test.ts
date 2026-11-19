// SPDX-License-Identifier: GPL-2.0-or-later
// The P4 rename comparison (p4-compare.ts): a new task id is applied field by field, so a task that
// shares its id with the default scenario `plan` leaves the scenario keys alone (nightly 2026-11-18).
import { describe, expect, it } from 'vitest';
import type { ScheduleResult, TaskResult } from '../../src/engine/protocol';
import { normalized, withTaskId } from './p4-compare';

const task = (id: string, name: string, deps: string[] = [], pre: string[] = []): TaskResult => ({
	id,
	name,
	parent: null,
	source: { file: 'plan.tjp', line: 3, column: null },
	milestone: false,
	scenarios: {
		plan: {
			scheduled: true,
			start: 0,
			end: 60,
			allocated: ['ana'],
			criticalness: 0,
			pathCriticalness: 0,
			direction: 'asap',
			complete: null,
			depends: deps.map((t) => ({ task: t, onEnd: true, gapDurationMin: 0, gapLengthMin: 0 })),
			precedes: pre.map((t) => ({ task: t, onEnd: false, gapDurationMin: 0, gapLengthMin: 0 })),
			allocate: [{ candidates: ['ana'] }],
		},
	},
});

const result = (tasks: TaskResult[]): ScheduleResult => ({
	revision: 1,
	ok: true,
	project: null,
	tasks,
	resources: [],
	bookings: tasks.map((t) => ({
		scenario: 'plan',
		resource: 'ana',
		task: t.id,
		intervals: [[0, 60]],
	})),
	messages: [
		{
			level: 'warning',
			id: 'minstart',
			text: 'x',
			file: 'plan.tjp',
			line: 3,
			column: null,
			scenario: 'plan',
		},
	],
	timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 1, serializeMs: 0, totalMs: 1 },
});

describe('withTaskId', () => {
	it('renames the task, the entries naming it and its bookings, not the scenario `plan`', () => {
		const before = result([task('plan', 'Plan'), task('qa', 'Qa', ['plan'], ['plan'])]);
		const after = result([task('x', 'x'), task('qa', 'Qa', ['x'], ['x'])]);
		const r = withTaskId(before, 'plan', 'x');
		expect(r.tasks.map((t) => t.id)).toEqual(['x', 'qa']);
		expect(Object.keys(r.tasks[0]?.scenarios ?? {})).toEqual(['plan']);
		expect(r.tasks[1]?.scenarios['plan']?.depends[0]?.task).toBe('x');
		expect(r.tasks[1]?.scenarios['plan']?.precedes[0]?.task).toBe('x');
		expect(r.bookings.map((b) => [b.scenario, b.task])).toEqual([
			['plan', 'x'],
			['plan', 'qa'],
		]);
		expect(r.messages[0]?.scenario).toBe('plan');
		expect(normalized(r, true)).toBe(normalized(after, true));
		// The replacement over the JSON text it replaces renamed the scenario too.
		const textual = normalized(before, true).replaceAll('"plan"', '"x"');
		expect(textual).not.toBe(normalized(after, true));
	});

	it('leaves other ids alone, including ones that start with the old id', () => {
		const before = result([task('plan', 'Plan'), task('planning', 'P', ['plan'])]);
		const r = withTaskId(before, 'plan', 'x');
		expect(r.tasks.map((t) => t.id)).toEqual(['x', 'planning']);
		expect(r.tasks[1]?.scenarios['plan']?.depends[0]?.task).toBe('x');
	});

	it('still sees a real change', () => {
		const before = result([task('plan', 'Plan')]);
		const moved = result([task('x', 'x')]);
		const s = moved.tasks[0]?.scenarios['plan'];
		if (s) s.start = 30;
		expect(normalized(withTaskId(before, 'plan', 'x'), true)).not.toBe(normalized(moved, true));
	});
});
