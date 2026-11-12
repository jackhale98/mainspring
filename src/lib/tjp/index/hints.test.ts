// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../../engine/protocol';
import { HintTable, hintsFromResult } from './hints';

const task = (id: string, parent: string | null, file: string, line: number | null) => ({
	id,
	name: id,
	parent,
	source: { file, line, column: null },
	milestone: false,
	scenarios: {},
});

describe('hintsFromResult', () => {
	it('maps lines and drops entries without a line or with an unmapped one', () => {
		const r = {
			tasks: [
				task('a', null, 'p.tjp', 3),
				task('b', null, 'p.tjp', null),
				task('c', null, 'p.tjp', 9),
			],
			resources: [{ ...task('r', null, 'p.tjp', 1), group: false }],
		} as unknown as ScheduleResult;
		const hints = hintsFromResult(r, (_f, l) => (l === 9 ? null : l + 1));
		expect(hints.tasks).toEqual([{ id: 'a', parent: null, file: 'p.tjp', line: 4 }]);
		expect(hints.resources).toEqual([{ id: 'r', parent: null, file: 'p.tjp', line: 2 }]);
	});
});

describe('HintTable.candidates', () => {
	const table = new HintTable({
		tasks: [
			{ id: 'g1.t', parent: 'g1', file: 't.tji', line: 1 },
			{ id: 'g2.t', parent: 'g2', file: 't.tji', line: 1 },
		],
		resources: [],
	});

	it('filters by parent, local id and ids already taken', () => {
		const none = (): boolean => false;
		expect(table.candidates('task', 't.tji', 1, undefined, null, none)).toHaveLength(2);
		expect(table.candidates('task', 't.tji', 1, 'g2', null, none).map((e) => e.id)).toEqual([
			'g2.t',
		]);
		expect(table.candidates('task', 't.tji', 1, undefined, 'x', none)).toEqual([]);
		expect(
			table.candidates('task', 't.tji', 1, undefined, 't', (id) => id === 'g1.t'),
		).toHaveLength(1);
		expect(table.candidates('resource', 't.tji', 1, undefined, null, none)).toEqual([]);
	});
});
