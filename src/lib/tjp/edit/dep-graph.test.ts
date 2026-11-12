// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { depOnEnd, isMilestone, newLoop, taskState, topScenario } from './dep-graph';
import { setup } from './testing';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const SCEN =
	'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario late "Late"\n  }\n}\n' +
	'resource r "R"\n';

const at = { file: 'plan.tjp', from: 0 };

describe('taskState', () => {
	it('reads the scheduling direction as the last write, from the parent at declaration', () => {
		const s = setup(
			HEAD +
				'task g "G" {\n  scheduling alap\n  task x "X"\n  task y "Y" { start 2026-01-06 }\n}\n' +
				'task z "Z" { end 2026-02-01 depends g }\n',
		);
		expect(taskState(s.snap, s.index, 'g.x').state.forward).toBe(false);
		expect(taskState(s.snap, s.index, 'g.y').state.forward).toBe(true);
		expect(taskState(s.snap, s.index, 'z').state.forward).toBe(true);
	});

	it('inherits depends, precedes and allocate written before the child', () => {
		const s = setup(
			HEAD +
				'task a "A"\ntask g "G" {\n  depends a\n  allocate r\n  task x "X"\n  precedes b\n  task y "Y"\n}\n' +
				'task b "B"\n',
		);
		const x = taskState(s.snap, s.index, 'g.x');
		expect(x.inherited?.depends.map((d) => d.target)).toEqual(['a']);
		expect(x.inherited?.allocs).toEqual(['r']);
		expect(x.inherited?.precedes).toEqual([]);
		expect(taskState(s.snap, s.index, 'g.y').inherited?.precedes.map((d) => d.target)).toEqual([
			'b',
		]);
		expect(taskState(s.snap, s.index, 'a').inherited).toBeNull();
	});

	it('applies a scenario prefix to that scenario and the ones below it', () => {
		const s = setup(SCEN + 'task a "A"\ntask b "B" { late:depends !a plan:allocate r }\n');
		expect(topScenario(s.index)).toBe('plan');
		expect(taskState(s.snap, s.index, 'b', 'plan').state.depends).toEqual([]);
		expect(taskState(s.snap, s.index, 'b', 'late').state.depends).toHaveLength(1);
		expect(taskState(s.snap, s.index, 'b', 'late').state.allocs).toEqual(['r']);
	});

	it('promotes plain leaves to milestones as markAsMilestone does', () => {
		const s = setup(
			HEAD +
				'task a "A"\ntask b "B" { depends !a }\ntask c "C" { depends !a end 2026-02-02 }\n' +
				'task d "D" { effort 1d allocate r }\ntask e "E" { milestone }\n',
		);
		const ms = (id: string): boolean => isMilestone(taskState(s.snap, s.index, id).state, false);
		expect(['a', 'b', 'c', 'd', 'e'].map(ms)).toEqual([true, true, false, false, true]);
		expect(isMilestone(taskState(s.snap, s.index, 'a').state, true)).toBe(false);
	});
});

describe('depOnEnd', () => {
	it('defaults to the end for depends and the start for precedes; the last keyword wins', () => {
		const s = setup(
			HEAD +
				'task a "A"\ntask b "B" { depends !a { onstart onend } precedes !c }\ntask c "C"\n' +
				'task d "D" { depends !a { onstart } }\n',
		);
		const by = (succ: string) => s.index.dependencies.find((d) => d.succ === succ);
		const b = by('b');
		const c = by('c');
		const d = by('d');
		expect(b && depOnEnd(s.snap, b)).toBe(true);
		expect(c && depOnEnd(s.snap, c)).toBe(false);
		expect(d && depOnEnd(s.snap, d)).toBe(false);
	});
});

describe('newLoop', () => {
	it('finds new loops only, per scenario', () => {
		const plan =
			SCEN +
			'task a "A" { effort 1d allocate r }\ntask b "B" { effort 1d late:depends !a allocate r }\n';
		const s = setup(plan);
		const back = { owner: 'a', form: 'depends' as const, target: 'b', onEnd: true, at };
		expect(newLoop(s.snap, s.index, [back])).toBe('late');
		expect(newLoop(s.snap, s.index, [{ ...back, owner: 'b', target: 'a' }])).toBeNull();
	});

	it('reports nothing new for a plan that already loops', () => {
		const s = setup(
			HEAD +
				'task a "A" { effort 1d depends !b allocate r }\ntask b "B" { effort 1d depends !a allocate r }\n' +
				'task c "C" { effort 1d allocate r }\n',
		);
		expect(
			newLoop(s.snap, s.index, [{ owner: 'c', form: 'depends', target: 'a', onEnd: true, at }]),
		).toBeNull();
	});

	it('walks containers, precedes and milestones as checkForLoops does', () => {
		const s = setup(
			HEAD +
				'task g "G" {\n  task x "X" { effort 1d allocate r }\n}\ntask m "M" { milestone }\n' +
				'task n "N" { milestone depends !m { onstart } }\n',
		);
		const dep = (owner: string, target: string, onEnd = true) => ({
			owner,
			form: 'depends' as const,
			target,
			onEnd,
			at,
		});
		expect(newLoop(s.snap, s.index, [dep('g.x', 'm'), dep('m', 'g')])).toBe('plan');
		// n starts after m starts. Milestones walk end to start, so m after n's end loops; a
		// start-to-start link back is no loop to TaskJuggler's walk but a cycle of time points.
		expect(newLoop(s.snap, s.index, [dep('m', 'n')])).toBe('plan');
		expect(newLoop(s.snap, s.index, [dep('m', 'n', false)])).toBe('plan');
		const prec = { owner: 'g', form: 'precedes' as const, target: 'm', onEnd: false, at };
		expect(newLoop(s.snap, s.index, [prec])).toBeNull();
		expect(newLoop(s.snap, s.index, [prec, dep('g.x', 'm')])).toBe('plan');
	});
});
