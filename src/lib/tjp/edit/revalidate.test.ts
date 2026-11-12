// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { changeSets, checkValuesAfter, newValueErrors, snapshotAfter } from './revalidate';
import { setup } from './testing';
import type { EditOp } from './types';

const PLAN =
	'project p "P" 2026-01-05 - 2026-02-01\ntask t "T" {\n  start 2026-01-20\n  duration 1d\n}\n';

const replace = (from: number, to: number, insert: string): EditOp => ({
	file: 'plan.tjp',
	from,
	to,
	insert,
	element: { from, to },
});

describe('revalidate', () => {
	it('applies ops to a copy of the snapshot', () => {
		const s = setup(PLAN);
		const at = PLAN.indexOf('2026-02-01');
		const sets = changeSets(s.snap, [replace(at, at + 10, '2026-03-01')]);
		const after = snapshotAfter(s.snap, sets);
		expect(after.files.get('plan.tjp')?.text.toString()).toContain('2026-01-05 - 2026-03-01');
		expect(s.snap.files.get('plan.tjp')?.text.toString()).toBe(PLAN);
	});

	it('reports value errors the change adds, in pre-edit coordinates', () => {
		const s = setup(PLAN);
		const end = PLAN.indexOf('2026-02-01');
		const shrink = replace(end, end + 10, '2026-01-15');
		const date = PLAN.indexOf('2026-01-20');
		expect(newValueErrors(s.ctx, [shrink])).toEqual([
			{ file: 'plan.tjp', from: date, to: date + 10 },
		]);
		expect(checkValuesAfter(s.ctx, [shrink])).toMatchObject({ reason: 'invalid-value' });
		expect(checkValuesAfter(s.ctx, [replace(end, end + 10, '2026-03-01')])).toBeNull();
	});
});
