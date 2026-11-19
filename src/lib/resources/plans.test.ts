// SPDX-License-Identifier: GPL-2.0-or-later
// The resource table's commands as view planners (plans.ts, ADR-0018 decision 3): steps through
// `planRegroup` on the tree of the text now, its refusals and the table's edge sentence, adds where
// the + puts them, and a gone or changed resource refused, never sent to the end of the list.
import { describe, expect, it } from 'vitest';
import { world } from '../state/rebase-testing';
import { refusalStrings } from '../strings';
import { resourceStrings as R } from '../strings-resources';
import { addResourcePlan, stepResourcePlan } from './plans';

const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'resource dev "Dev" {',
	'  resource ann "Ann"',
	'  resource bob "Bob"',
	'}',
	'resource t1 "T1"',
	'resource cy "Cy"',
	'task t "T" {',
	'  effort 1d',
	'  allocate t1',
	'}',
	'',
].join('\n');

const on = () => {
	const w = world(PLAN);
	return w.base(w.version());
};

describe('stepResourcePlan', () => {
	it('moves one place through planRegroup, with its label', () => {
		expect(stepResourcePlan('bob', 'up')(on())).toEqual({
			status: 'intent',
			intent: { type: 'moveResource', resource: 'bob', parent: 'dev', index: 0 },
			label: { text: R.label.reordered('Bob'), approx: false },
		});
		expect(stepResourcePlan('ann', 'outdent')(on())).toEqual({
			status: 'intent',
			intent: { type: 'moveResource', resource: 'ann', parent: null, index: 1 },
			label: { text: R.label.movedOut('Ann', 'Dev'), approx: false },
		});
	});

	it('keeps the planner’s refusals and the table’s sentence at an edge', () => {
		expect(stepResourcePlan('cy', 'indent')(on())).toMatchObject({
			status: 'not-possible',
			message: R.refuse.notAGroup('T1'),
		});
		expect(stepResourcePlan('ann', 'up')(on())).toEqual({
			status: 'unchanged',
			message: R.table.nowhere('up'),
		});
		expect(stepResourcePlan('cy', 'down')(on())).toEqual({
			status: 'unchanged',
			message: R.table.nowhere('down'),
		});
	});

	it('refuses a resource that is gone, or whose id now names another declaration', () => {
		expect(stepResourcePlan('zed', 'up')(on())).toEqual({
			status: 'not-possible',
			message: refusalStrings['unknown-target'],
			at: [],
		});
		const w = world(PLAN);
		const v0 = w.version();
		// Typed: cy becomes cz, then t1 becomes cy.
		const cy = w.text().indexOf('resource cy') + 'resource '.length;
		w.type(cy, cy + 2, 'cz');
		const t1 = w.text().indexOf('resource t1') + 'resource '.length;
		w.type(t1, t1 + 2, 'cy');
		expect(stepResourcePlan('cy', 'up')(w.base(v0))).toMatchObject({
			status: 'not-possible',
			message: refusalStrings['target-changed'],
		});
	});
});

describe('addResourcePlan', () => {
	const add = (parent: string | null, index: number, kind: 'person' | 'group' = 'person') => ({
		status: 'intent',
		intent: { type: 'addResource', parent, index, name: 'Eve' },
		label: {
			text: kind === 'group' ? R.label.groupAdded('Eve') : R.label.added('Eve'),
			approx: false,
		},
	});

	it('adds at the end, into a selected group, or after the selected person', () => {
		expect(addResourcePlan(null, 'person', 'Eve')(on())).toEqual(add(null, 3));
		expect(addResourcePlan('dev', 'person', 'Eve')(on())).toEqual(add('dev', 2));
		expect(addResourcePlan('ann', 'person', 'Eve')(on())).toEqual(add('dev', 1));
		expect(addResourcePlan('dev', 'group', 'Eve')(on())).toEqual(add(null, 1, 'group'));
	});

	it('refuses a gone selection instead of adding at the end', () => {
		expect(addResourcePlan('zed', 'person', 'Eve')(on())).toEqual({
			status: 'not-possible',
			message: refusalStrings['unknown-target'],
			at: [],
		});
	});
});
