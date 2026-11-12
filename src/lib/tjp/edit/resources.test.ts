// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	addResource,
	deleteResource,
	moveResource,
	removeResourceAttr,
	renameResource,
	setResourceAttr,
} from './resources';
import { setup, textsAfter } from './testing';

const PLAN =
	'project p "P" 2026-01-05 +1m\nresource g "G" {\n  resource a "A"\n}\nresource b "B"\n';

describe('resource wrappers', () => {
	it('build each intent and apply it', () => {
		const s = setup(PLAN);
		const text = (r: ReturnType<typeof addResource>): string | undefined =>
			textsAfter(s.snap, r)['plan.tjp'];
		expect(text(addResource(s.snap, s.index, 'g', 1, 'c', 'C', [['rate', '2']]))).toContain(
			'  resource a "A"\n  resource c "C" {\n    rate 2\n  }\n',
		);
		expect(text(addResource(s.snap, s.index, null, 0, undefined, 'New'))).toContain(
			'resource new "New"',
		);
		expect(text(deleteResource(s.snap, s.index, 'b'))).not.toContain('"B"');
		expect(text(moveResource(s.snap, s.index, 'b', 'g', 0))).toContain(
			'  resource b "B"\n  resource a',
		);
		expect(text(renameResource(s.snap, s.index, 'a', 'Ay'))).toContain('resource a "Ay"');
		expect(text(setResourceAttr(s.snap, s.index, 'b', 'email', '"b@x"'))).toContain(
			'resource b "B" {\n  email "b@x"\n}',
		);
		expect(removeResourceAttr(s.snap, s.index, 'b', 'email')).toMatchObject({
			reason: 'not-present',
		});
	});
});
