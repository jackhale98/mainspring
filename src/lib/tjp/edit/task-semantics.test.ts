// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { checkEdited, checkNewParent } from './task-semantics';
import { afterEdit } from './task-verify';
import { setup, span } from './testing';

const H = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const same = (id: string): string => id;

describe('checkNewParent', () => {
	it('refuses a leaf with its own sizing or milestone, not a container', () => {
		const s = setup(
			H +
				'task a "A" { allocate r effort 1d }\ntask m "M" { milestone }\ntask c "C" { task k "K" }\n',
		);
		const get = (id: string) => s.index.tasks.get(id) ?? null;
		expect(checkNewParent(s.ctx, get('a'))).toMatchObject({ reason: 'conflicting-attribute' });
		expect(checkNewParent(s.ctx, get('m'))).toMatchObject({ reason: 'conflicting-attribute' });
		expect(checkNewParent(s.ctx, get('c'))).toBeNull();
		expect(checkNewParent(s.ctx, null)).toBeNull();
	});
});

describe('checkEdited', () => {
	it('refuses a lost inherited allocation of an effort task', () => {
		const text = H + 'task p "P" {\n  allocate r\n  task x "X" { effort 1d }\n}\n';
		const s = setup(text);
		const f = s.file();
		// Drop the parent's allocation by hand: x keeps its effort and loses its resource.
		const at = span(f, '  allocate r\n');
		const ops = [{ file: 'plan.tjp', from: at.from, to: at.to, insert: '', element: at }];
		const edited = afterEdit(s.ctx, ops, same);
		expect(checkEdited(s.ctx, edited, { moved: ['p.x'], map: same, at: [] })).toMatchObject({
			reason: 'conflicting-attribute',
		});
		expect(
			checkEdited(s.ctx, afterEdit(s.ctx, [], same), { moved: ['p.x'], map: same, at: [] }),
		).toBeNull();
	});

	it('refuses a new dependency loop', () => {
		const s = setup(H + 'task a "A" { duration 1d }\ntask b "B" { duration 1d depends a }\n');
		const f = s.file();
		const at = span(f, 'duration 1d }\ntask b').from + 'duration 1d'.length;
		const ops = [
			{ file: 'plan.tjp', from: at, to: at, insert: ' depends b', element: { from: at, to: at } },
		];
		expect(checkEdited(s.ctx, afterEdit(s.ctx, ops, same), { map: same, at: [] })).toMatchObject({
			reason: 'cycle',
		});
	});
});
