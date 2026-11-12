// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../../engine/protocol';
import { textOf } from '../document';
import { HintTable, fresh, hintsFromResult } from './hints';

const task = (id: string, parent: string | null, file: string, line: number | null) => ({
	id,
	name: id,
	parent,
	source: { file, line, column: null },
	milestone: false,
	scenarios: {},
});

describe('hintsFromResult', () => {
	const r = {
		tasks: [
			task('a', null, 'p.tjp', 3),
			task('b', null, 'p.tjp', null),
			task('c', null, 'p.tjp', 9),
		],
		resources: [{ ...task('r', null, 'p.tjp', 1), group: false }],
	} as unknown as ScheduleResult;

	it('maps lines and drops entries without a line or with an unmapped one', () => {
		const hints = hintsFromResult(r, (_f, l) => (l === 9 ? null : l + 1));
		expect(hints.tasks).toEqual([{ id: 'a', parent: null, file: 'p.tjp', line: 4 }]);
		expect(hints.resources).toEqual([{ id: 'r', parent: null, file: 'p.tjp', line: 2 }]);
	});

	it('fingerprints each hint with the scheduled line text', () => {
		const hints = hintsFromResult(
			r,
			(_f, l) => l,
			(_f, l) => `line ${l}`,
		);
		expect(hints.tasks.map((e) => e.text)).toEqual(['line 3', 'line 9']);
	});
});

describe('fresh', () => {
	const doc = textOf('a\ntask ${x} "X"\n');
	it('needs the line to exist and, with a fingerprint, to read the same', () => {
		const e = { id: 'x', parent: null, file: 'p.tjp', line: 2 };
		expect(fresh(e, doc)).toBe(true);
		expect(fresh({ ...e, text: 'task ${x} "X"' }, doc)).toBe(true);
		expect(fresh({ ...e, text: 'task ${y} "Y"' }, doc)).toBe(false);
		expect(fresh({ ...e, line: 9 }, doc)).toBe(false);
	});
});

describe('HintTable.candidates', () => {
	const doc = textOf('task t "T"\n');
	const table = new HintTable({
		tasks: [
			{ id: 'g1.t', parent: 'g1', file: 't.tji', line: 1 },
			{ id: 'g2.t', parent: 'g2', file: 't.tji', line: 1 },
			{ id: 'g1.u', parent: 'g1', file: 't.tji', line: 1, text: 'something else' },
		],
		resources: [],
	});
	const none = (): boolean => false;
	const cands = (
		parent: string | null | undefined,
		local: string | null,
		others: string[] = [],
		taken: (id: string) => boolean = none,
	) => table.candidates('task', 't.tji', 1, doc, parent, local, others, taken).map((e) => e.id);

	it('filters by fingerprint, parent, local id, the line literals and ids already taken', () => {
		expect(cands(undefined, null)).toEqual(['g1.t', 'g2.t']);
		expect(cands('g2', null)).toEqual(['g2.t']);
		expect(cands(undefined, 'x')).toEqual([]);
		expect(cands(undefined, null, ['t'])).toEqual([]);
		expect(cands(undefined, 't', [], (id) => id === 'g1.t')).toEqual(['g2.t']);
		expect(table.candidates('resource', 't.tji', 1, doc, undefined, null, [], none)).toEqual([]);
	});
});
