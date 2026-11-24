// SPDX-License-Identifier: GPL-2.0-or-later
// The output builder and conflict id keys (out.ts).
import { describe, expect, it } from 'vitest';
import { hash, idKey, Out, type Pending } from './out';

const pending = (over: Partial<Pending>): Pending => ({
	subject: { kind: 'attribute', owner: { kind: 'task', id: 'a', name: 'A' }, attr: 'effort' },
	base: 'effort 1d',
	ours: 'effort 2d',
	theirs: 'effort 3d',
	at: { from: 0, to: 9 },
	atOurs: { from: 0, to: 9 },
	atBase: { from: 10, to: 19 },
	both: false,
	...over,
});

describe('Out', () => {
	it('builds text and moves appended conflicts to where they land', () => {
		const out = new Out();
		expect(out.push('ab')).toEqual({ from: 0, to: 2 });
		const inner = new Out();
		inner.push('xyz');
		inner.conflict(pending({ at: { from: 1, to: 2 } }));
		out.append(inner);
		expect(out.text()).toBe('abxyz');
		expect(out.conflicts[0]?.at).toEqual({ from: 3, to: 4 });
		expect(out.pos).toBe(5);
	});
});

describe('idKey', () => {
	it('depends on the file, subject, base range and theirs, never on ours or positions in ours', () => {
		const k = idKey('plan.tjp', pending({}));
		expect(k).toMatch(/^plan\.tjp#attribute:effort@10-19:[0-9a-f]{14}$/);
		expect(
			idKey(
				'plan.tjp',
				pending({ ours: 'effort 9d', at: { from: 5, to: 14 }, atOurs: { from: 5, to: 14 } }),
			),
		).toBe(k);
		expect(
			idKey(
				'plan.tjp',
				pending({
					subject: {
						kind: 'attribute',
						owner: { kind: 'task', id: 'b', name: 'B' },
						attr: 'effort',
					},
				}),
			),
		).toBe(k);
		expect(idKey('plan.tjp', pending({ theirs: 'effort 4d' }))).not.toBe(k);
		expect(idKey('plan.tjp', pending({ atBase: { from: 11, to: 19 } }))).not.toBe(k);
		expect(idKey('a.tji', pending({}))).not.toBe(k);
		expect(idKey('plan.tjp', pending({ subject: { kind: 'text' } }))).toMatch(/#text@/);
	});

	it('hashes strings to 14 hex digits, deterministically', () => {
		expect(hash('x')).toBe(hash('x'));
		expect(hash('x')).not.toBe(hash('y'));
		expect(hash('')).toHaveLength(14);
	});
});
