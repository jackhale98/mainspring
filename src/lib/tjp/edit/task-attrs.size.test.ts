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
import { corpusPlans, load, type Loaded } from './testing-plans';
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

	it('refuses removing the size of a start-only leaf a successor waits on, or of one without ends', () => {
		for (const attr of ['effort', 'length', 'duration'] as const) {
			const waited =
				`task x "X" { ${attr} 1d allocate ana start 2026-01-12 }\n` +
				'task s "S" { depends x length 1d }\n';
			expect(run(waited, { type: 'removeAttr', task: 'x', attr })).toMatchObject({
				reason: 'conflicting-attribute',
			});
			const none = `task x "X" { ${attr} 1d allocate ana }\n`;
			expect(run(none, { type: 'removeAttr', task: 'x', attr })).toMatchObject({
				reason: 'conflicting-attribute',
			});
		}
		// End-only, with a predecessor through `precedes` (native E1).
		const e1 =
			'task t "T" { end 2026-02-12 allocate ana effort 1d }\ntask s "S" { precedes t length 1d }\n';
		expect(run(e1, { type: 'removeAttr', task: 't', attr: 'effort' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('allows a start-only leaf a `depends … { onstart }` names, on it or its parent (S1, P3)', () => {
		const s1 =
			'task t "T" { start 2026-01-12 allocate ana effort 1d }\n' +
			'task s "S" { depends t { onstart } length 1d }\n';
		expect(run(s1, { type: 'removeAttr', task: 't', attr: 'effort' })).toMatchObject({
			status: 'edit',
		});
		const p3 =
			'task q "Q" {\n  task t "T" { start 2026-01-12 allocate ana effort 1d }\n}\n' +
			'task s "S" { depends q { onstart } length 1d }\n';
		expect(run(p3, { type: 'removeAttr', task: 'q.t', attr: 'effort' })).toMatchObject({
			status: 'edit',
		});
		// `{ onend }` (the default) still waits on the end.
		const onend = s1.replace('{ onstart }', '{ onend }');
		expect(run(onend, { type: 'removeAttr', task: 't', attr: 'effort' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('allows open-ended allocated work: one end and nothing waiting on the other', () => {
		// q3: from its start to the project end.
		const q3 = 'task t "T" { start 2026-01-12 allocate ana effort 2d }\n';
		expect(run(q3, { type: 'removeAttr', task: 't', attr: 'effort' })).toMatchObject({
			status: 'edit',
		});
		// From the project start to its end; a successor of its end does not matter (native E2).
		const e2 =
			'task t "T" { end 2026-02-12 allocate ana effort 1d }\ntask s "S" { depends t length 1d }\n';
		expect(run(e2, { type: 'removeAttr', task: 't', attr: 'effort' })).toMatchObject({
			status: 'edit',
		});
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

describe('corpus tasks whose last size can go (open-ended allocated work)', () => {
	const plans = corpusPlans();
	const loaded = (name: string): Loaded => {
		const p = plans.find((c) => c.name.endsWith(name));
		if (!p) throw new Error(`no corpus plan ${name}`);
		return load(p.name, p.plan);
	};
	/** The task with an `effort` statement on 1-based `line` of the entry file. */
	const atLine = (c: Loaded, line: number): string => {
		const text = c.snap.files.get(c.snap.entry)?.text;
		for (const [id, t] of c.index.tasks) {
			const e = t.attrs.find((a) => a.keyword === 'effort');
			if (e && text && text.lineAt(e.statement.from).number === line) return id;
		}
		throw new Error(`no effort on line ${line}`);
	};

	it('removes effort from the 15-allocate-select, 01-shifts-resource and Scrum examples', () => {
		const select = loaded('15-allocate-select');
		const ids = [49, 77, 104, 118, 135].map((n) => atLine(select, n));
		const cases: Array<[Loaded, string]> = [
			...ids.map((id): [Loaded, string] => [select, id]),
			[loaded('01-shifts-resource'), 'project.build'],
			[loaded('Scrum'), 'product.s3.t2'],
		];
		for (const [c, task] of cases) {
			const r = applyIntent(c.snap, c.index, { type: 'removeAttr', task, attr: 'effort' });
			expect({ task, status: r.status }).toEqual({ task, status: 'edit' });
		}
	});
});
