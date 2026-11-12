// SPDX-License-Identifier: GPL-2.0-or-later
// Removing a task's last size (`milestone`, `effort`, `length`, `duration`) through setAttr or
// removeAttr is refused when the leaf would be underspecified (dep-graph.ts `isUnderspecified`):
// an allocation keeps it from becoming a milestone, and it lacks a start or an end. Found by the
// T18 fidelity suite (generated seed 2147483638: `task db "Db" { milestone depends !x }` under an
// allocating parent whose successor makes it fail natively with `task_underspecified`). Checked in
// native tj3 3.8.4: the T18 shape fails, the accepted results schedule. A leaf with only one end
// fails or not depending on the rest of the plan (a successor of it or its parent), so those
// removals are refused whatever the rest is.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { setup } from './testing';
import type { EditIntent, EditResult } from './types';

const H = 'project p "P" 2026-01-05 +5m\nresource ana "Ana"\n';

function run(body: string, intent: EditIntent): EditResult {
	const s = setup(H + body);
	return applyIntent(s.snap, s.index, intent);
}

const T18 =
	'task g "G" {\n  allocate ana\n  task x "X" { effort 13h }\n  task db "Db" { milestone depends !x }\n}\n' +
	'task s "S" { length 2h depends g }\n';

describe('removing the last size of an allocated leaf', () => {
	it('refuses milestone=false and removeAttr milestone with only a start (T18 seed 2147483638)', () => {
		expect(
			run(T18, { type: 'setAttr', task: 'g.db', attr: 'milestone', value: false }),
		).toMatchObject({ status: 'refused', reason: 'conflicting-attribute' });
		expect(run(T18, { type: 'removeAttr', task: 'g.db', attr: 'milestone' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses removing effort, length or duration from a leaf with an allocation and one end', () => {
		for (const attr of ['effort', 'length', 'duration'] as const) {
			const plan = `task x "X" { ${attr} 1d allocate ana start 2026-01-12 }\n`;
			expect(run(plan, { type: 'removeAttr', task: 'x', attr })).toMatchObject({
				reason: 'conflicting-attribute',
			});
		}
	});

	it('allows it without an allocation (milestone promotion) or with both ends', () => {
		const free = 'task x "X" { effort 1d allocate ana }\ntask m "M" { milestone depends x }\n';
		expect(run(free, { type: 'removeAttr', task: 'm', attr: 'milestone' })).toMatchObject({
			status: 'edit',
		});
		const both =
			'task x "X" { effort 1d allocate ana }\ntask z "Z" { start 2026-03-01 length 1d }\n' +
			'task y "Y" { effort 1d allocate ana depends x precedes z }\n';
		expect(run(both, { type: 'removeAttr', task: 'y', attr: 'effort' })).toMatchObject({
			status: 'edit',
		});
		// Another size stays: nothing is lost.
		const two = 'task x "X" { allocate ana start 2026-01-12 effort 1d }\n';
		expect(run(two, { type: 'setAttr', task: 'x', attr: 'length', value: '2d' })).toMatchObject({
			status: 'edit',
		});
	});
});
