// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { declareFlag, removeAttr, renameTask, setAttr } from './task-attrs-api';
import { setup, textsAfter } from './testing';

describe('task attribute wrappers', () => {
	it('build the intent and run it', () => {
		const s = setup('project p "P" 2026-01-05 +2m\ntask a "A" {\n  effort 1d\n}\n');
		const r = setAttr(s.snap, s.index, 'a', 'effort', '2d', { id: 'w1' });
		expect(r.status === 'edit' && r.edit).toMatchObject({
			id: 'w1',
			intent: { type: 'setAttr', task: 'a', attr: 'effort', value: '2d' },
		});
		expect(textsAfter(s.snap, removeAttr(s.snap, s.index, 'a', 'effort'))['plan.tjp']).toBe(
			'project p "P" 2026-01-05 +2m\ntask a "A" {\n}\n',
		);
		expect(renameTask(s.snap, s.index, 'a', 'B').status).toBe('edit');
		expect(declareFlag(s.snap, s.index, 'f').status).toBe('edit');
	});
});
