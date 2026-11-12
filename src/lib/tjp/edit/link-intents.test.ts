// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import {
	addAllocation,
	addDepends,
	allocate,
	removeAllocation,
	removeDepends,
	replaceAllocation,
	setDependsGap,
} from './link-intents';
import { setup } from './testing';
import type { EditIntent, EditResult } from './types';

const PLAN =
	'project p "P" 2026-01-05 +2m\nresource r "R"\nresource q "Q"\n' +
	'task a "A" { effort 1d allocate r }\ntask c "C"\ntask b "B" { effort 1d depends !c allocate r }\n';

describe('wrappers', () => {
	it('give the same result as applyIntent with the intent they build', () => {
		const s = setup(PLAN);
		const same = (r: EditResult, intent: EditIntent): void => {
			const want = applyIntent(s.snap, s.index, intent, { id: 'x' });
			expect(r.status).toBe(want.status);
			if (r.status === 'edit' && want.status === 'edit') {
				expect(r.edit.intent).toEqual(intent);
				expect(r.edit.changes).toEqual(want.edit.changes);
			}
		};
		const o = { id: 'x' };
		same(addDepends(s.snap, s.index, 'b', 'a', o), { type: 'addDepends', task: 'b', target: 'a' });
		same(removeDepends(s.snap, s.index, 'b', 'c', o), {
			type: 'removeDepends',
			task: 'b',
			target: 'c',
		});
		const gap = { kind: 'gaplength', value: '1d' } as const;
		same(setDependsGap(s.snap, s.index, 'b', 'c', gap, o), {
			type: 'setDependsGap',
			task: 'b',
			target: 'c',
			gap,
		});
		same(allocate(s.snap, s.index, 'a', ['q'], o), {
			type: 'allocate',
			task: 'a',
			resources: ['q'],
		});
		same(addAllocation(s.snap, s.index, 'a', 'q', o), {
			type: 'addAllocation',
			task: 'a',
			resource: 'q',
		});
		same(removeAllocation(s.snap, s.index, 'a', 'r', o), {
			type: 'removeAllocation',
			task: 'a',
			resource: 'r',
		});
		same(replaceAllocation(s.snap, s.index, 'a', 'r', 'q', o), {
			type: 'replaceAllocation',
			task: 'a',
			from: 'r',
			to: 'q',
		});
	});
});
