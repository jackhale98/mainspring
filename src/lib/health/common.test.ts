// SPDX-License-Identifier: GPL-2.0-or-later
// What the checks share (common.ts): the run's task tree, working days, the text-only reasons of
// a fix (task, site, allocation), group members and the resource a task's `allocate` writes.
import { describe, expect, it } from 'vitest';
import { at, plan } from '../schedule/testing';
import { resourceResult, withPeople } from '../workload/testing';
import {
	checkedTasks,
	leavesOf,
	replaceReason,
	roundDays,
	runOf,
	selfAndAncestors,
	taskReason,
	workingDays,
	writtenCandidate,
} from './common';
import { inlineInput } from './testing';

const TEXT = `macro made [task made "Made" {}]
macro who [ann]
project p "P" 2026-01-05 - 2026-03-02 {
}
resource team "Team" {
  resource dev "Dev"
}
resource ann "Ann"
task g "G" {
  task a "A" {
    allocate dev
  }
  task b "B" {
    allocate \${who}
  }
}
\${made}
`;
const RESULT = withPeople(
	plan([
		['g', { start: at(0, 9), end: at(1, 17) }],
		['g.a', { start: at(0, 9), end: at(1, 17), parent: 'g' }],
		['g.b', { start: at(0, 9), end: at(0, 13), parent: 'g' }],
		['made', { start: at(0, 9), end: at(0, 17) }],
		['ghost', { start: at(0, 9), end: at(0, 17) }],
	]),
	[
		resourceResult('team', { group: true }),
		resourceResult('dev', { parent: 'team' }),
		resourceResult('ann'),
	],
	[],
);
const run = runOf(inlineInput(RESULT, TEXT));

describe('health common', () => {
	it('reads the tree: leaves and milestones are checked, containers are not', () => {
		if (!run) throw new Error('no run');
		expect(checkedTasks(run)).toEqual(['g.a', 'g.b', 'made', 'ghost']);
		expect(selfAndAncestors(run, 'g.a')).toEqual(['g.a', 'g']);
		expect(run.dayMin).toBe(480);
	});

	it('counts working days of the project calendar, either way round', () => {
		if (!run) throw new Error('no run');
		expect(workingDays(run, at(0, 9), at(1, 17))).toBe(2);
		expect(workingDays(run, at(1, 17), at(0, 9))).toBe(2);
		expect(workingDays(run, at(0, 9), at(0, 13))).toBe(0.5);
		expect([roundDays(2.375), roundDays(0.04), roundDays(20)]).toEqual([2.4, 0, 20]);
	});

	it('gives the text-only reason of a task and of its allocation', () => {
		if (!run) throw new Error('no run');
		expect(taskReason(run, 'g.a')).toBeNull();
		// Declared through a macro call only, or not in the text at all.
		expect(taskReason(run, 'made')).toBe('expanded-only');
		expect(taskReason(run, 'ghost')).toBe('expanded-only');
		expect(replaceReason(run, 'g.a', 'dev')).toBeNull();
		// `allocate ${who}`: the item may name the person, so the edit cannot tell.
		expect(replaceReason(run, 'g.b', 'ann')).toBe('macro-call');
		expect(replaceReason(run, 'made', 'ann')).toBe('expanded-only');
	});

	it('expands groups and finds the candidate a task writes', () => {
		const leaves = leavesOf(RESULT);
		expect([leaves('team'), leaves('dev'), leaves('ann')]).toEqual([['dev'], ['dev'], ['ann']]);
		const s = (candidates: string[][]) => ({
			...(RESULT.tasks[1]?.scenarios['plan'] ?? (null as never)),
			allocate: candidates.map((c) => ({ candidates: c })),
		});
		expect(writtenCandidate(s([['team']]), 'dev', leaves)).toBe('team');
		expect(writtenCandidate(s([['ann', 'dev']]), 'dev', leaves)).toBe('dev');
		expect(writtenCandidate(s([]), 'dev', leaves)).toBe('dev');
	});
});
