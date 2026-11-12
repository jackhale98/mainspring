// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	addLeave,
	removeLeave,
	removeProjectAttr,
	setProjectAttr,
	setProjectHeader,
	setWorkingHours,
	updateLeave,
} from './settings';
import { setup, span, textsAfter } from './testing';
import type { EditResult } from './types';

const PLAN =
	'project p "P" 2026-01-05 +2m {\n  now 2026-01-06\n}\nleaves holiday 2026-01-12\nresource a "A"\n';

describe('project and calendar wrappers', () => {
	it('build each intent and apply it', () => {
		const s = setup(PLAN);
		const text = (r: EditResult): string | undefined => textsAfter(s.snap, r)['plan.tjp'];
		const item = { file: 'plan.tjp', ...span(s.file(), 'holiday 2026-01-12') };
		expect(text(setProjectHeader(s.snap, s.index, { name: 'Q', end: '+3m' }))).toContain(
			'project p "Q" 2026-01-05 +3m {',
		);
		expect(text(setProjectAttr(s.snap, s.index, 'currency', '"EUR"'))).toContain(
			'  currency "EUR"\n',
		);
		expect(text(removeProjectAttr(s.snap, s.index, 'now'))).toContain(
			'project p "P" 2026-01-05 +2m {\n}',
		);
		expect(
			text(setWorkingHours(s.snap, s.index, { kind: 'resource', resource: 'a' }, ['sat'], 'off')),
		).toContain('resource a "A" {\n  workinghours sat off\n}');
		expect(
			text(addLeave(s.snap, s.index, { kind: 'global' }, { type: 'sick', start: '2026-01-13' })),
		).toContain('leaves holiday 2026-01-12, sick 2026-01-13\n');
		expect(
			text(updateLeave(s.snap, s.index, { item }, { type: 'holiday', start: '2026-01-19' })),
		).toContain('leaves holiday 2026-01-19\n');
		expect(text(removeLeave(s.snap, s.index, { item }))).not.toContain('leaves');
	});
});
