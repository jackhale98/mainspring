// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { insertStatement } from './layout';
import { withAttrs } from './task-add-attrs';
import { ops, setup, stmt } from './testing';
import { isRefused } from './types';

const H = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';

describe('withAttrs', () => {
	const s = setup(H + 'task p "P" {\n  allocate r\n}\n');
	const f = s.file();
	const bare = ops(insertStatement(f, stmt(f, 'task p'), 'task n "N"', 'end'));

	it('composes setAttr steps into changes to the original text', () => {
		const r = withAttrs(
			s.ctx,
			bare,
			'p.n',
			[
				['effort', '2d'],
				['priority', '600'],
			],
			[],
		);
		if (isRefused(r)) throw new Error(JSON.stringify(r));
		expect(r).toHaveLength(1);
		expect(r[0]?.insert).toBe('  task n "N" {\n    priority 600\n    effort 2d\n  }\n');
	});

	it('returns the bare ops without attributes and refuses what setAttr refuses', () => {
		expect(withAttrs(s.ctx, bare, 'p.n', [], [])).toEqual(bare);
		const at = [{ file: 'plan.tjp', from: 0, to: 0 }];
		expect(withAttrs(s.ctx, bare, 'p.n', [['effort', 'soon']], at)).toEqual({
			status: 'refused',
			reason: 'invalid-value',
			at,
		});
	});
});
