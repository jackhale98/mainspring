// SPDX-License-Identifier: GPL-2.0-or-later
// The statement-by-statement merge of a hunk (keyed.ts): repeated keys, moves, deletions,
// additions on both sides.
import { describe, expect, it } from 'vitest';
import { merge1, resolveAll } from './testing';

const HEAD = 'project p "P" 2027-01-04 +3m\nresource dev "Dev"\ntask x "X"\ntask y "Y"\n';
const T = (lines: string): string => `${HEAD}task a "A" {\n${lines}}\n`;
const text = (m: ReturnType<typeof merge1>): string => m.files.get('plan.tjp') ?? '';

describe('keyed merge', () => {
	it('aligns repeated statements by their text', () => {
		const base = T('  depends x\n  depends y\n  effort 1d\n');
		const m = merge1(
			base,
			T('  depends x\n  effort 2d\n'),
			T('  depends x\n  depends y\n  effort 1d\n  allocate dev\n'),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(T('  depends x\n  effort 2d\n  allocate dev\n'));
	});

	it('moves a statement on one side cleanly when the other left the hunk alone', () => {
		const base = T('  effort 1d\n  allocate dev\n  priority 5\n');
		const m = merge1(base, T('  priority 5\n  effort 1d\n  allocate dev\n'), base);
		expect(m.conflicts).toEqual([]);
	});

	it('makes a statement moved on one side and changed on the other one conflict, never a copy', () => {
		const base = T('  effort 1d\n  allocate dev\n  priority 5\n');
		const m = merge1(
			base,
			T('  priority 5\n  effort 1d\n  allocate dev\n'),
			T('  effort 1d\n  allocate dev\n  priority 7\n'),
		);
		expect(m.conflicts).toHaveLength(1);
		for (const take of ['ours', 'theirs'] as const) {
			expect(
				resolveAll(m, take)
					.get('plan.tjp')
					?.match(/priority/g),
			).toHaveLength(1);
		}
	});

	it('takes what both sides added alike, and classifies the rest', () => {
		const base = T('  effort 1d\n');
		const m = merge1(
			base,
			T('  effort 1d\n  complete 50\n  priority 5\n'),
			T('  effort 1d\n  complete 50\n  note "n"\n'),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(T('  effort 1d\n  complete 50\n  priority 5\n  note "n"\n'));
	});

	it('deletes cleanly what one side deleted and the other left alone', () => {
		const base = T('  effort 1d\n  allocate dev\n  priority 5\n');
		const m = merge1(
			base,
			T('  effort 2d\n  priority 5\n'),
			T('  effort 1d\n  allocate dev\n  priority 5\n  note "n"\n'),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(T('  effort 2d\n  priority 5\n  note "n"\n'));
	});
});
