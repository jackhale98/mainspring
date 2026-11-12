// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../index';
import { removeStatement, replaceSpan } from './layout';
import { afterEdit, snapshotAfter, verifyTree } from './task-verify';
import { setup, span, stmt } from './testing';

const H = 'project p "P" 2026-01-05 +2m\n';
const PLAN = H + 'task a "A" { task x "X" }\ntask b "B" { depends a.x }\n';

describe('snapshotAfter', () => {
	it('applies ops and keeps unchanged files', () => {
		const s = setup({ 'plan.tjp': PLAN + 'include "c.tji"\n', 'c.tji': 'task c "C"\n' });
		const f = s.file();
		const next = snapshotAfter(s.snap, [removeStatement(f, stmt(f, 'task b'))]).snap;
		expect(next.files.get('plan.tjp')?.text.toString()).toBe(
			H + 'task a "A" { task x "X" }\ninclude "c.tji"\n',
		);
		expect(next.files.get('c.tji')).toBe(s.snap.files.get('c.tji'));
		expect([...buildIndex(next).tasks.keys()]).toEqual(['a', 'a.x', 'c']);
	});
});

describe('verifyTree', () => {
	it('accepts an edit that gives the expected tree and references', () => {
		const s = setup(PLAN);
		const f = s.file();
		const ops = [removeStatement(f, stmt(f, 'task b'))];
		const gone = (id: string): string | null => (id === 'b' ? null : id);
		const dropped = (at: { from: number }): boolean => at.from > stmt(f, 'task b').from;
		expect(
			verifyTree(
				s.ctx,
				afterEdit(s.ctx, ops, gone),
				{ map: gone, dropped },
				'unfixable-reference',
				[],
			),
		).toBeNull();
	});

	it('refuses when a reference no longer names its target', () => {
		const s = setup(PLAN);
		const f = s.file();
		const ops = [replaceSpan(f, span(f, 'task x "X"'), 'task y "X"')];
		const map = (id: string): string => (id === 'a.x' ? 'a.y' : id);
		expect(
			verifyTree(s.ctx, afterEdit(s.ctx, ops, map), { map }, 'unfixable-reference', []),
		).toMatchObject({
			reason: 'unfixable-reference',
		});
	});
});
