// SPDX-License-Identifier: GPL-2.0-or-later
// Engine errors the text decides, refused by the task tree intents (task-semantics.ts). Every
// plan here was checked in native tj3 3.8.4 and the wasm engine: the refused edits give
// `task_underspecified` or `container_booking` (an allocated leaf with only a start or only an end
// fails when it or its parent has a successor), the accepted ones schedule.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { setup } from './testing';
import type { EditIntent, EditResult } from './types';

const H =
	'project p "P" 2026-01-05 - 2026-03-27 {\n  timingresolution 60min\n}\n' +
	'resource a "A"\ntask x "X" { start 2026-01-10 }\n';

function run(body: string, intent: EditIntent): EditResult {
	const s = setup(H + body);
	return applyIntent(s.snap, s.index, intent);
}

const ALLOC = 'task p "P" { allocate a\n  task c "C" { effort 2d }\n}\n';

describe('task_underspecified', () => {
	it('refuses a new leaf that inherits an allocation and has no ends or dependencies', () => {
		expect(run(ALLOC, { type: 'addTask', parent: 'p', index: 1, name: 'New' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		const add = (attrs: Extract<EditIntent, { type: 'addTask' }>['attrs']): EditIntent => ({
			type: 'addTask',
			parent: 'p',
			index: 1,
			name: 'New',
			...(attrs ? { attrs } : {}),
		});
		// A start alone schedules (to the project end) unless the parent has a successor (native B1).
		expect(run(ALLOC, add([['start', '2026-01-12']]))).toMatchObject({ status: 'edit' });
		const waited = ALLOC + 'task s "S" { depends p length 1d }\n';
		expect(run(waited, add([['start', '2026-01-12']]))).toMatchObject({
			reason: 'conflicting-attribute',
		});
		expect(
			run(
				ALLOC,
				add([
					['start', '2026-01-12'],
					['end', '2026-01-20'],
				]),
			),
		).toMatchObject({ status: 'edit' });
		// A parent's start is not inherited.
		const started = 'task p "P" { start 2026-01-12 allocate a\n  task c "C" { effort 2d }\n}\n';
		expect(run(started, { type: 'addTask', parent: 'p', index: 1, name: 'N' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses deleting the last child of an allocating task', () => {
		expect(run(ALLOC, { type: 'deleteTask', task: 'p.c' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		const inherited =
			'task r "R" { allocate a\n  task c "C" { start 2026-01-12 effort 2d }\n' +
			'  task b "B" {\n    task b1 "B1" { start 2026-01-12 effort 1d }\n  }\n}\n';
		expect(run(inherited, { type: 'deleteTask', task: 'r.b.b1' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses moving the last child out, and moving a bare leaf under an allocating task', () => {
		const own = 'task p "P" { allocate a\n  task c "C" { effort 2d allocate a }\n}\n';
		expect(run(own, { type: 'moveTask', task: 'p.c', parent: null, index: 0 })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		const bare = 'task p "P" { allocate a\n  task k "K" { effort 1d }\n}\ntask m "M"\n';
		expect(run(bare, { type: 'moveTask', task: 'm', parent: 'p', index: 1 })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses deleting the only dependency of an allocating leaf, not one it keeps another of', () => {
		const dep = 'task p "P" { depends x allocate a }\n';
		expect(run(dep, { type: 'deleteTask', task: 'x' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		const two = 'task y "Y" { start 2026-01-11 }\ntask p "P" { depends x, y allocate a }\n';
		expect(run(two, { type: 'deleteTask', task: 'x' })).toMatchObject({ status: 'edit' });
	});
});

describe('open-ended allocated leaves (native q1, q2, q4, A1, D0, D1)', () => {
	it('allows a start-only leaf with nothing waiting on its end (q4)', () => {
		const q4 =
			'task p "P" { allocate a\n  task k "K" { effort 1d }\n}\ntask m "M" { start 2026-01-12 }\n';
		expect(run(q4, { type: 'moveTask', task: 'm', parent: 'p', index: 1 })).toMatchObject({
			status: 'edit',
		});
		// A1: a successor of its end makes the same move fail natively.
		const a1 = q4 + 'task s "S" { depends p.k, m length 1d }\n';
		expect(run(a1, { type: 'moveTask', task: 'm', parent: 'p', index: 1 })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('checks the leaves of a container whose inherited dependency a delete removes (q1, D1)', () => {
		const q1 = 'task C "C" { depends x\n  task c "C1" { allocate a }\n}\n';
		expect(run(q1, { type: 'deleteTask', task: 'x' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		// q2: the leaf's own only dependency goes, so it has neither end.
		const q2 = 'task C "C" { allocate a\n  task c "C1" { depends x }\n}\n';
		expect(run(q2, { type: 'deleteTask', task: 'x' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses removing the size of a start-only leaf a successor waits on (D1)', () => {
		const d1 =
			'task t "T" { depends x allocate a effort 1d }\ntask s "S" { depends t length 1d }\n';
		expect(run(d1, { type: 'removeAttr', task: 't', attr: 'effort' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		expect(
			run('task t "T" { depends x allocate a effort 1d }\n', {
				type: 'removeAttr',
				task: 't',
				attr: 'effort',
			}),
		).toMatchObject({ status: 'edit' });
	});
});

describe('container_booking', () => {
	it('refuses a child under a leaf with bookings', () => {
		const booked =
			'task p "P" { start 2026-01-12 allocate a scheduled\n' +
			'  booking a 2026-01-12-09:00 +4h }\ntask m "M" { milestone }\n';
		const add: EditIntent = {
			type: 'addTask',
			parent: 'p',
			index: 0,
			name: 'N',
			attrs: [['milestone', true]],
		};
		expect(run(booked, add)).toMatchObject({ reason: 'conflicting-attribute' });
		expect(run(booked, { type: 'moveTask', task: 'm', parent: 'p', index: 0 })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});
});
