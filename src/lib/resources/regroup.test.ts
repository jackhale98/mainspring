// SPDX-License-Identifier: GPL-2.0-or-later
// W6, regrouping people (regroup.ts): the plan for a drop, a key or the Group select, its exact patch
// through the edit API, and the refusals: `not-a-group` (a person that tasks are allocated to cannot
// take members), into itself, and the same place.
import { describe, expect, it } from 'vitest';
import { applyIntent } from '../tjp/edit/apply';
import { setup, textsAfter } from '../tjp/edit/testing';
import { canTake, groupChoices, planGroupSelect, planRegroup, regroupLabel } from './regroup';

const TEXT = `project p "P" 2026-03-02 +8w
resource team "Team" {
  resource a "Ann"
  resource b "Bob"
}
resource c "Cy"
resource crew "Crew"
task t1 "Build" { effort 2d  allocate a }
task t2 "Test" { effort 2d  allocate c }
`;
const s = setup(TEXT);

const patched = (r: ReturnType<typeof planRegroup>): string => {
	if (r.status !== 'intent') throw new Error(`not an intent: ${r.reason}`);
	return textsAfter(s.snap, applyIntent(s.snap, s.index, r.intent))['plan.tjp'] as string;
};

describe('planRegroup', () => {
	it('moves a person into a group, as its last member, with its label', () => {
		const r = planRegroup(s.index, 'c', 'team', 2);
		expect(r).toMatchObject({
			status: 'intent',
			intent: { type: 'moveResource', resource: 'c', parent: 'team', index: 2 },
			label: { text: 'Cy moved into Team' },
		});
		expect(patched(r)).toBe(`project p "P" 2026-03-02 +8w
resource team "Team" {
  resource a "Ann"
  resource b "Bob"
  resource c "Cy"
}
resource crew "Crew"
task t1 "Build" { effort 2d  allocate a }
task t2 "Test" { effort 2d  allocate c }
`);
	});

	it('moves a member out to the top level, and says so', () => {
		const r = planRegroup(s.index, 'b', null, 3);
		expect(r).toMatchObject({
			status: 'intent',
			intent: { parent: null, index: 3 },
			label: { text: 'Bob moved out of Team' },
		});
		expect(patched(r)).toContain('resource b "Bob"\ntask t1');
	});

	it('reorders among the siblings', () => {
		const r = planRegroup(s.index, 'b', 'team', 0);
		expect(r).toMatchObject({ status: 'intent', label: { text: 'Bob moved' } });
		expect(patched(r)).toContain(
			'resource team "Team" {\n  resource b "Bob"\n  resource a "Ann"\n}',
		);
	});

	it('clamps an index past the end', () => {
		expect(planRegroup(s.index, 'c', 'team', 99)).toMatchObject({
			intent: { type: 'moveResource', index: 2 },
		});
	});

	it('refuses a drop on a resource that tasks are allocated to: not-a-group', () => {
		const r = planRegroup(s.index, 'b', 'c', 0);
		expect(r).toMatchObject({
			status: 'not-possible',
			reason: 'not-a-group',
			message: 'Cy has tasks, so people cannot join it. Make a group for them instead.',
		});
		if (r.status === 'not-possible') expect(r.at).toHaveLength(1);
	});

	it('takes an empty resource nothing allocates as a group that is still empty', () => {
		const r = planRegroup(s.index, 'c', 'crew', 0);
		expect(r.status).toBe('intent');
		expect(patched(r)).toContain('resource crew "Crew" {\n  resource c "Cy"\n}');
	});

	it('refuses a move into itself or into its own group, and a move that changes nothing', () => {
		expect(planRegroup(s.index, 'team', 'team', 0)).toMatchObject({ reason: 'into-itself' });
		expect(planRegroup(s.index, 'team', 'a', 0)).toMatchObject({ reason: 'into-itself' });
		expect(planRegroup(s.index, 'a', 'team', 0)).toMatchObject({ reason: 'same-place' });
		expect(planRegroup(s.index, 'c', null, 1)).toMatchObject({ reason: 'same-place' });
		expect(planRegroup(s.index, 'ghost', null, 0)).toMatchObject({ reason: 'unknown' });
	});
});

describe('canTake and the group choices', () => {
	it('a group, or a resource with no members that nothing allocates', () => {
		expect(canTake(s.index, 'team')).toBe(true);
		expect(canTake(s.index, 'crew')).toBe(true);
		expect(canTake(s.index, 'a')).toBe(false);
		expect(canTake(s.index, 'c')).toBe(false);
		expect(canTake(s.index, 'nobody')).toBe(false);
	});

	it('lists the groups a resource can go to, outside its own subtree, with their depth', () => {
		expect(groupChoices(s.index, 'c')).toEqual([
			{ id: 'team', name: 'Team', level: 0 },
			// Bob has no members and no allocation: a group that is still empty.
			{ id: 'b', name: 'Bob', level: 1 },
			{ id: 'crew', name: 'Crew', level: 0 },
		]);
		expect(groupChoices(s.index, 'team').map((g) => g.id)).toEqual(['crew']);
	});
});

describe('planGroupSelect', () => {
	it('is a move to the end of the group, or to the end of the top level', () => {
		expect(planGroupSelect(s.index, 'c', 'team')).toMatchObject({
			intent: { type: 'moveResource', resource: 'c', parent: 'team', index: 2 },
		});
		expect(planGroupSelect(s.index, 'a', null)).toMatchObject({
			intent: { parent: null, index: 3 },
		});
		expect(planGroupSelect(s.index, 'a', 'c')).toMatchObject({ reason: 'not-a-group' });
	});

	it('names where it went', () => {
		expect(regroupLabel(s.index, 'c', 'team', null)).toBe('Cy moved into Team');
		expect(regroupLabel(s.index, 'a', null, 'team')).toBe('Ann moved out of Team');
		expect(regroupLabel(s.index, 'a', 'team', 'team')).toBe('Ann moved');
	});
});
